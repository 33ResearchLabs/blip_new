import { Idl } from "@coral-xyz/anchor";

/**
 * Convert type from Anchor 0.30+ format to Anchor 0.29 format
 * Main differences:
 * - "pubkey" -> "publicKey"
 * - { defined: { name: "X" } } -> { defined: "X" }
 */
export function convertType(type: any): any {
  if (type === "pubkey") return "publicKey";
  if (type === "string") return "string";
  if (typeof type === "string") return type;

  if (type && typeof type === "object") {
    if (type.array) {
      return { array: [convertType(type.array[0]), type.array[1]] };
    }
    if (type.vec) {
      return { vec: convertType(type.vec) };
    }
    if (type.option) {
      return { option: convertType(type.option) };
    }
    if (type.defined) {
      if (typeof type.defined === "object" && type.defined.name) {
        return { defined: type.defined.name };
      }
      return { defined: type.defined };
    }
  }

  return type;
}

export function convertFields(fields: any[]): any[] {
  if (!fields) return [];
  return fields.map((field: any) => ({
    name: field.name,
    type: convertType(field.type),
  }));
}

/**
 * Convert a new-format IDL (Anchor 0.30+) into the shape the 0.29 client
 * accepts. Safe to run on an already-0.29 IDL — `convertType` is a no-op
 * on primitive strings, and account/field conversion is idempotent.
 *
 * NOTE: an earlier version of this function short-circuited on "accounts
 * look fine" which meant instruction args kept the nested
 * `{defined: {name: "X"}}` shape → the 0.29 Borsh instruction coder
 * blew up with `Type not found`. The current version always walks the
 * whole tree.
 */
export function convertIdlToAnchor29(idl: any): Idl {
  // Detect new-format signals (best-effort; conversion is safe regardless).
  const hasNewFormatSignal = !!(
    idl.address ||
    (idl.metadata && !idl.name) ||
    (idl.accounts?.length && idl.accounts.some((a: any) => !a.type)) ||
    // Instruction args with nested `{defined: {name}}` — the thing that actually
    // breaks the 0.29 Borsh coder.
    (idl.instructions || []).some((ix: any) =>
      (ix.args || []).some(
        (arg: any) =>
          arg?.type?.defined && typeof arg.type.defined === "object" && arg.type.defined.name,
      ),
    )
  );

  if (!hasNewFormatSignal) {
    // Already-0.29 IDL — return as-is.
    return idl as Idl;
  }

  // Build type map for the types table.
  const typeMap = new Map<string, any>();
  for (const typeDef of idl.types || []) {
    const converted: any = {
      name: typeDef.name,
      type: {
        kind: typeDef.type?.kind || "struct",
      },
    };

    if (typeDef.type?.kind === "struct") {
      converted.type.fields = convertFields(typeDef.type.fields || []);
    } else if (typeDef.type?.kind === "enum") {
      converted.type.variants = (typeDef.type.variants || []).map((v: any) => ({
        name: v.name,
        ...(v.fields ? { fields: convertFields(v.fields) } : {}),
      }));
    }

    typeMap.set(typeDef.name, converted);
  }

  const convertedTypes = Array.from(typeMap.values());

  const converted = {
    address: idl.address || idl.metadata?.address || "",
    metadata: {
      name: idl.metadata?.name || idl.name || "unknown",
      version: idl.metadata?.version || idl.version || "0.1.0",
      spec: idl.metadata?.spec || "0.1.0",
      ...(idl.metadata?.description ? { description: idl.metadata.description } : {}),
    },
    version: idl.metadata?.version || idl.version || "0.1.0",
    name: idl.metadata?.name || idl.name || "unknown",
    instructions: (idl.instructions || []).map((ix: any) => ({
      name: ix.name,
      accounts: (ix.accounts || []).map((acc: any) => ({
        // 0.30+ IDL uses snake_case account names; anchor@0.29's
        // `validateAccounts` looks them up by the exact IDL key. Every
        // client call site passes camelCase keys, so we camelCase the
        // IDL here and the two sides align. Inlined to avoid any
        // Turbopack module-init-order ambiguity around helper hoisting.
        name: typeof acc.name === "string" && acc.name.includes("_")
          ? acc.name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
          : acc.name,
        isMut: acc.writable ?? acc.isMut ?? false,
        isSigner: acc.signer ?? acc.isSigner ?? false,
        ...(acc.optional || acc.isOptional ? { isOptional: true } : {}),
      })),
      args: (ix.args || []).map((arg: any) => ({
        name: arg.name,
        type: convertType(arg.type),
      })),
    })),
    // CRITICAL: accounts array kept empty so Anchor's AccountClient doesn't
    // try to build a coder for the new-format account defs at Program
    // instantiation time. Reads still work via the types table below.
    accounts: [],
    types: convertedTypes,
    errors: idl.errors || [],
    // 0.30+ events don't carry `fields` inline — they reference a type by
    // name. The 0.29 client crashes if events lack `fields`. Materialise
    // fields from the types table (or drop the event if no type exists).
    events: (idl.events || [])
      .map((ev: any) => {
        if (Array.isArray(ev.fields)) return ev;
        const typeDef = typeMap.get(ev.name);
        if (typeDef?.type?.fields) {
          return { name: ev.name, fields: typeDef.type.fields };
        }
        return null;
      })
      .filter(Boolean),
  } as unknown as Idl;

  return converted;
}
