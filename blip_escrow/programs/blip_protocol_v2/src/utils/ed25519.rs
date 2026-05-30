use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked;
use solana_program::ed25519_program;
use crate::errors::ErrorCode;

const ED25519_HEADER: usize = 16;
const SIG_LEN: usize = 64;
const PUB_LEN: usize = 32;
const SELF_REF: u16 = u16::MAX;

/// Verify that an Ed25519Program instruction at `ix_index` in the current
/// transaction cryptographically binds (`expected_pubkey`, `expected_message`,
/// `expected_signature`). Must be called with the Instructions sysvar.
pub fn verify_ed25519_ix(
    instructions_sysvar: &AccountInfo,
    ix_index: u16,
    expected_pubkey: &[u8; 32],
    expected_message: &[u8],
    expected_signature: &[u8; 64],
) -> Result<()> {
    let ix = load_instruction_at_checked(ix_index as usize, instructions_sysvar)
        .map_err(|_| error!(ErrorCode::InvalidSignature))?;

    require!(ix.program_id == ed25519_program::ID, ErrorCode::InvalidSignature);

    let data = &ix.data;
    require!(data.len() >= ED25519_HEADER, ErrorCode::InvalidSignature);
    require!(data[0] == 1 && data[1] == 0, ErrorCode::InvalidSignature);

    let sig_off    = u16::from_le_bytes([data[2],  data[3]])  as usize;
    let sig_ix_idx = u16::from_le_bytes([data[4],  data[5]]);
    let pk_off     = u16::from_le_bytes([data[6],  data[7]])  as usize;
    let pk_ix_idx  = u16::from_le_bytes([data[8],  data[9]]);
    let msg_off    = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size   = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_idx = u16::from_le_bytes([data[14], data[15]]);

    require!(sig_ix_idx == SELF_REF || sig_ix_idx == ix_index, ErrorCode::InvalidSignature);
    require!(pk_ix_idx  == SELF_REF || pk_ix_idx  == ix_index, ErrorCode::InvalidSignature);
    require!(msg_ix_idx == SELF_REF || msg_ix_idx == ix_index, ErrorCode::InvalidSignature);

    require!(sig_off.saturating_add(SIG_LEN)   <= data.len(), ErrorCode::InvalidSignature);
    require!(pk_off.saturating_add(PUB_LEN)    <= data.len(), ErrorCode::InvalidSignature);
    require!(msg_off.saturating_add(msg_size)  <= data.len(), ErrorCode::InvalidSignature);

    require!(&data[pk_off..pk_off + PUB_LEN]   == expected_pubkey,   ErrorCode::InvalidSignature);
    require!(&data[sig_off..sig_off + SIG_LEN] == expected_signature, ErrorCode::InvalidSignature);
    require!(
        msg_size == expected_message.len()
            && &data[msg_off..msg_off + msg_size] == expected_message,
        ErrorCode::InvalidSignature
    );

    Ok(())
}
