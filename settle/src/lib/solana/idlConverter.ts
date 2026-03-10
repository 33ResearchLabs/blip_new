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
 * Convert new Anchor 0.30+ IDL format to Anchor 0.29 compatible format
 */
export function convertIdlToAnchor29(idl: any): Idl {
  // Check if accounts already have proper type structure - this is the KEY indicator
  const hasProperAccounts =
    (idl.accounts || []).length === 0 ||
    (idl.accounts || []).every((acc: any) => acc.type && acc.type.kind && (acc.type.fields || acc.type.variants));

  // If accounts have proper types, don't convert - regardless of other fields
  if (hasProperAccounts && idl.accounts?.length > 0) {
    console.log("[IDL] Accounts already have proper type structure, skipping conversion:", idl.name || idl.metadata?.name);
    return idl as Idl;
  }

  if (idl.version && idl.name && hasProperAccounts) {
    console.log("[IDL] Already in Anchor 0.29 format:", idl.name);
    return idl as Idl;
  }

  const isNewFormat = !!(idl.address || (idl.metadata && !idl.name) || (idl.accounts?.length && !idl.accounts[0].type));

  if (!isNewFormat) {
    console.log("[IDL] Already in old format:", idl.name || idl.metadata?.name);
    return idl as Idl;
  }

  console.log("[IDL] Converting from Anchor 0.30+ format:", idl.metadata?.name || idl.name);

  // Build type map
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

  // Convert accounts
  const convertedAccounts = (idl.accounts || []).map((acc: any) => {
    if (acc.type && acc.type.kind) {
      return {
        name: acc.name,
        type: {
          kind: acc.type.kind,
          fields: acc.type.fields ? convertFields(acc.type.fields) : [],
          ...(acc.type.variants ? { variants: acc.type.variants } : {}),
        },
      };
    }

    const typeDef = typeMap.get(acc.name);
    return {
      name: acc.name,
      type: typeDef?.type || { kind: "struct", fields: [] },
    };
  });

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
        name: acc.name,
        isMut: acc.writable ?? acc.isMut ?? false,
        isSigner: acc.signer ?? acc.isSigner ?? false,
        ...(acc.optional || acc.isOptional ? { isOptional: true } : {}),
      })),
      args: (ix.args || []).map((arg: any) => ({
        name: arg.name,
        type: convertType(arg.type),
      })),
    })),
    accounts: [], // CRITICAL: Empty to prevent Anchor AccountClient validation during Program instantiation
    types: convertedTypes,
    errors: idl.errors || [],
    events: idl.events || [],
  } as unknown as Idl;

  console.log("[IDL] Converted successfully:", (converted as any).name || converted.metadata?.name);
  return converted;
}
