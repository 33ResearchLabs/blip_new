/**
 * IDL Converter for Anchor 0.32+
 * Converts Anchor 0.30+ IDL format to a format compatible with Anchor 0.32
 */

import { Idl } from '@coral-xyz/anchor';

/**
 * Convert type from new format to old format
 */
function convertType(type: any): any {
  if (type === 'pubkey') return 'publicKey';
  if (typeof type === 'string') return type;

  if (type && typeof type === 'object') {
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
      if (typeof type.defined === 'object' && type.defined.name) {
        return { defined: type.defined.name };
      }
      return { defined: type.defined };
    }
  }

  return type;
}

/**
 * Convert struct fields
 */
function convertFields(fields: any[]): any[] {
  if (!fields) return [];
  return fields.map((field: any) => ({
    name: field.name,
    type: convertType(field.type),
  }));
}

/**
 * Convert IDL to Anchor 0.32 compatible format
 */
export function convertIdlToAnchor32(idl: any): Idl {
  // CRITICAL: Always remove accounts array to prevent AccountClient validation
  // Even if the IDL is already in the correct format, we must strip accounts
  if (idl.version && idl.name && idl.accounts?.[0]?.type?.kind) {
    console.log('[IDL] Already in Anchor 0.32 format, removing accounts array:', idl.name);
    return {
      ...idl,
      accounts: [], // CRITICAL: Empty accounts to prevent validation
    } as Idl;
  }

  console.log('[IDL] Converting to Anchor 0.32 format:', idl.metadata?.name || idl.name);

  // Build type map
  const typeMap = new Map<string, any>();

  for (const typeDef of (idl.types || [])) {
    const converted: any = {
      name: typeDef.name,
      type: {
        kind: typeDef.type?.kind || 'struct',
      },
    };

    if (typeDef.type?.kind === 'struct') {
      converted.type.fields = convertFields(typeDef.type.fields || []);
    } else if (typeDef.type?.kind === 'enum') {
      converted.type.variants = (typeDef.type.variants || []).map((v: any) => ({
        name: v.name,
        ...(v.fields ? { fields: convertFields(v.fields) } : {}),
      }));
    }

    typeMap.set(typeDef.name, converted);
  }

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
      type: typeDef?.type || { kind: 'struct', fields: [] },
    };
  });

  // Build final IDL
  // IMPORTANT: Remove accounts array to prevent Anchor 0.32 from trying to validate
  // that accounts exist on-chain during Program instantiation
  const converted = {
    address: idl.address || idl.metadata?.address,
    version: idl.metadata?.version || idl.version || '0.1.0',
    name: idl.metadata?.name || idl.name || 'unknown',
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
    accounts: [], // Empty to prevent AccountClient validation
    types: Array.from(typeMap.values()),
    errors: idl.errors || [],
    events: idl.events || [],
    metadata: idl.metadata || { address: idl.address },
  } as Idl;

  console.log('[IDL] Converted IDL (accounts disabled for validation)');
  return converted;
}
