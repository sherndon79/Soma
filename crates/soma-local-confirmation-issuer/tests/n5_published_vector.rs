use soma_local_confirmation_issuer::{
    verify_assertion_signature, verify_raw_assertion, IssuerPolicy, RawAssertion,
};

// Published by Yubico in libfido2's BSD-2-Clause regression suite:
// https://github.com/Yubico/libfido2/blob/8ee8e5a2eb94575c8baeda9c7bf1d4f27a3b1db4/regress/assert.c
#[test]
fn n5_yubico_es256_assertion_vector_verifies_without_relaxing_up_policy() {
    let challenge_hash =
        decode_32("ec8d8f78424a2bb78234aaca07a1f656421cb6f6b3008652352da2624abe8976");
    let authenticator_data = hex::decode(
        "49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763\
         0000000003",
    )
    .unwrap();
    let signature_der = hex::decode(
        "3046022100f6d1a3d5242bdeeea09089cdf89ebd6b4d5579e4c14227b79b9ba40a\
         e247640e022100e5c9c2834731c726e525b2b439a7fc3d70bee9810d4a62a9ab4a\
         91c07d2d231e",
    )
    .unwrap();
    let public_key = concat!(
        "04",
        "34eb9977029c3638bbc2aea0a018c664fce84992d7749e0c468c9da6df46f784",
        "601e0f8b23854a9aecc1089f30d00dd7767b5548917c4f0f641a1df8be14908a"
    );

    verify_assertion_signature(
        &authenticator_data,
        challenge_hash,
        public_key,
        &signature_der,
    )
    .unwrap();

    let policy = IssuerPolicy {
        schema_version: 1,
        rp_id: "localhost".to_string(),
        inventory_id: "published-vector".to_string(),
        exact_target: "published-vector".to_string(),
        credential_id: "published-vector".to_string(),
        credential_public_key_sec1: public_key.to_string(),
        require_uv: false,
        minimum_counter: 0,
    };
    let assertion = RawAssertion {
        credential_id: "published-vector".to_string(),
        authenticator_data,
        signature_der,
    };
    assert_eq!(
        verify_raw_assertion(&assertion, challenge_hash, &policy)
            .unwrap_err()
            .code,
        "lca_assertion_invalid",
        "the published vector intentionally has UP=0; Soma must not accept it as confirmation",
    );
}

fn decode_32(value: &str) -> [u8; 32] {
    hex::decode(value).unwrap().try_into().unwrap()
}
