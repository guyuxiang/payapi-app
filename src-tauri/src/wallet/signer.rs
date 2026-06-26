//! EIP-712 signing of EIP-3009 TransferWithAuthorization for USDC on Base.

use alloy_primitives::{Address, B256, U256};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::{sol, Eip712Domain, SolStruct};
use std::borrow::Cow;

sol! {
    #[allow(missing_docs)]
    struct TransferWithAuthorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }
}

#[derive(Debug, Clone)]
pub struct Authorization {
    pub from: Address,
    pub to: Address,
    pub value: U256,
    pub valid_after: U256,
    pub valid_before: U256,
    pub nonce: B256,
}

fn domain(name: &str, version: &str, chain_id: u64, usdc: Address) -> Eip712Domain {
    Eip712Domain {
        name: Some(Cow::Owned(name.to_string())),
        version: Some(Cow::Owned(version.to_string())),
        chain_id: Some(U256::from(chain_id)),
        verifying_contract: Some(usdc),
        salt: None,
    }
}

pub fn signing_digest(
    auth: &Authorization,
    name: &str,
    version: &str,
    chain_id: u64,
    usdc: Address,
) -> B256 {
    let msg = TransferWithAuthorization {
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.valid_after,
        validBefore: auth.valid_before,
        nonce: auth.nonce.into(),
    };
    msg.eip712_signing_hash(&domain(name, version, chain_id, usdc))
}

pub fn sign(
    signer: &PrivateKeySigner,
    auth: &Authorization,
    name: &str,
    version: &str,
    chain_id: u64,
    usdc: Address,
) -> Result<[u8; 65], String> {
    let digest = signing_digest(auth, name, version, chain_id, usdc);
    let sig = signer
        .sign_hash_sync(&digest)
        .map_err(|e| format!("sign: {e}"))?;
    Ok(sig.as_bytes())
}
