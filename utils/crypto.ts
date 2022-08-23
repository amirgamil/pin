//Much of this was ported from https://github.com/privacy-scaling-explorations/maci/blob/master/crypto/ts/index.ts

import * as circomlibjs from "circomlibjs";
import * as crypto from "crypto";
const ff = require("ffjavascript");
const createBlakeHash = require("blake-hash");
import assert from "assert";
import { createMerkleTree, formatPubKey } from "./zkp";

//@ts-ignore
let eddsa: any;

type PrivKey = BigInt;
type PubKey = BigInt[];
type EcdhSharedKey = BigInt;
type Plaintext = BigInt[];

interface Ciphertext {
    // The initialisation vector
    iv: BigInt;

    // The encrypted data
    data: BigInt[];
}

interface Keypair {
    privKey: PrivKey;
    pubKey: PubKey;
}

interface KeypairHex {
    privKey: string;
    pubKey: string;
}

const SNARK_FIELD_SIZE = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

/*
 * Returns a BabyJub-compatible random value. We create it by first generating
 * a random value (initially 256 bits large) modulo the snark field size as
 * described in EIP197. This results in a key size of roughly 253 bits and no
 * more than 254 bits. To prevent modulo bias, we then use this efficient
 * algorithm:
 * http://cvsweb.openbsd.org/cgi-bin/cvsweb/~checkout~/src/lib/libc/crypt/arc4random_uniform.c
 * @return A BabyJub-compatible random value.
 */
const genRandomBabyJubValue = (): BigInt => {
    // Prevent modulo bias
    //const lim = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
    //const min = (lim - SNARK_FIELD_SIZE) % SNARK_FIELD_SIZE
    const min = BigInt(
        "6350874878119819312338956282401532410528162663560392320966563075034087161851"
    );

    let rand;
    while (true) {
        rand = BigInt("0x" + crypto.randomBytes(32).toString("hex"));

        if (rand >= min) {
            break;
        }
    }

    const privKey: PrivKey = rand % SNARK_FIELD_SIZE;
    assert(privKey < SNARK_FIELD_SIZE);

    return privKey;
};

export const genPrivKey = () => {
    return genRandomBabyJubValue();
};

const bigIntToHex = (i: BigInt): string => {
    return bigInt2Buffer(i).toString("hex");
};

/*
 * Convert a BigInt to a Buffer
 */
const bigInt2Buffer = (i: BigInt): Buffer => {
    let hexStr = i.toString(16);
    while (hexStr.length < 64) {
        hexStr = "0" + hexStr;
    }
    return Buffer.from(hexStr, "hex");
};

const loadEddsa = async () => {
    if (!eddsa) {
        eddsa = await circomlibjs.buildEddsa();
    }
    return eddsa;
};

export const testBroken = async () => {
    await loadEddsa();
    console.log("HELLO");
    const plaintext = [BigInt(31), BigInt(12)];
    const sharedKey =
        BigInt(
            17708171275687628017204240208069223834215068267368546344451334093183644322044
        );
    const ciphertext = await encrypt(plaintext, sharedKey);
    const decrypted = await decrypt(ciphertext, sharedKey);
    console.log("ciphertext: ", ciphertext, " decrypted: ", decrypted);
    console.log("HELLO");
};

/*
 * @param privKey A private key generated using genPrivKey()
 * @return A public key associated with the private key
 */
const genPubKey = async (privKey: PrivKey): Promise<PubKey> => {
    privKey = BigInt(privKey.toString());
    assert(privKey < SNARK_FIELD_SIZE);
    await loadEddsa();
    return eddsa.prv2pub(bigInt2Buffer(privKey));
};

export const genKeypair = async (): Promise<Keypair> => {
    const privKey = genPrivKey();
    const pubKey = await genPubKey(privKey);

    const keypair: Keypair = { privKey, pubKey };

    return keypair;
};

export const genKeypairHex = async (): Promise<KeypairHex> => {
    const keypair = await genKeypair();
    return {
        privKey: bigInt2Buffer(keypair.privKey).toString("hex"),
        pubKey: bigInt2Buffer(keypair.privKey).toString("hex"),
    };
};

const uint8ArrToBigInt = (arr: Uint8Array): BigInt => {
    return BigInt("0x" + Buffer.from(arr).toString("hex"));
};

const encrypt = async (
    plaintext: Plaintext,
    sharedKey: EcdhSharedKey
): Promise<Ciphertext> => {
    await loadEddsa();
    // Generate the IV
    const temp = eddsa.mimc7.multiHash(plaintext, BigInt(0));
    console.log(Buffer.from(temp).toString("hex"));
    const iv = uint8ArrToBigInt(eddsa.mimc7.multiHash(plaintext, BigInt(0)));
    const ciphertext: Ciphertext = {
        iv,
        data: plaintext.map((e: BigInt, i: number): BigInt => {
            return (
                (BigInt(e) as bigint) +
                (uint8ArrToBigInt(
                    eddsa.mimc7.hash(sharedKey, iv + BigInt(i))
                ) as bigint)
            );
        }),
    };

    // TODO: add asserts here
    return ciphertext;
};

/*
 * Decrypts a ciphertext using a given key.
 * @return The plaintext.
 */
const decrypt = async (
    ciphertext: Ciphertext,
    sharedKey: EcdhSharedKey
): Promise<Plaintext> => {
    await loadEddsa();
    console.log("look here: ", ciphertext);
    const plaintext: Plaintext = ciphertext.data.map(
        (e: BigInt, i: number): BigInt => {
            console.log("------");
            console.log(
                e ===
                    uint8ArrToBigInt(
                        eddsa.mimc7.hash(
                            sharedKey,
                            BigInt(ciphertext.iv) + BigInt(i)
                        )
                    )
            );
            console.log("------");
            return (
                BigInt(e) -
                uint8ArrToBigInt(
                    eddsa.mimc7.hash(
                        sharedKey,
                        BigInt(ciphertext.iv) + BigInt(i)
                    )
                )
            );
        }
    );

    return plaintext;
};

/*
 * Generates an Elliptic-curve Diffie–Hellman shared key given a private key
 * and a public key.
 * @return The ECDH shared key.
 */
const genEcdhSharedKey = async (
    privKey: PrivKey,
    pubKey: PubKey
): Promise<EcdhSharedKey> => {
    await loadEddsa();
    return uint8ArrToBigInt(
        eddsa.babyJub.mulPointEscalar(
            pubKey,
            formatPrivKeyForBabyJub(privKey)
        )[0]
    );
};

/*
 * An internal function which formats a random private key to be compatible
 * with the BabyJub curve. This is the format which should be passed into the
 * PublicKey and other circuits.
 */
const formatPrivKeyForBabyJub = (privKey: PrivKey) => {
    const sBuff = eddsa.pruneBuffer(
        createBlakeHash("blake512")
            .update(bigInt2Buffer(privKey))
            .digest()
            .slice(0, 32)
    );
    const s = ff.utils.leBuff2int(sBuff);
    return ff.Scalar.shr(s, 3);
};

const prepareInputs = (
    opPubkey: Uint8Array[],
    signerPubkey: Uint8Array[],
    signerPrivKey: Uint8Array,
    ciphertext: Ciphertext
) => {
    const formattedOpPubKey = opPubkey.map((el) => uint8ArrToBigInt(el));
    const formattedSigPubKey = signerPubkey.map((el) => uint8ArrToBigInt(el));
    const formattedPrivKey = uint8ArrToBigInt(signerPrivKey);

    return {
        poolPubKey: formattedOpPubKey,
        ciphertext,
        signerPubkey: formattedSigPubKey,
        signerPrivKeyHash: formattedPrivKey,
    };
};

export async function testCircuit() {
    const signer = await genKeypair();

    const operator = await genKeypair();

    const publicKeyLeaves: PubKey[] = [];
    for (let i = 0; i < 5; i++) {
        publicKeyLeaves.push((await genKeypair()).pubKey);
    }
    publicKeyLeaves.push(signer.pubKey);

    const sharedSecret = await genEcdhSharedKey(
        signer.privKey,
        operator.pubKey
    );

    const plaintext: any[] = [
        BigInt(Math.floor(Math.random() * 50)),
        BigInt(Math.floor(Math.random() * 50)),
    ];

    // console.log(
    //     JSONStringifyCustom(createMerkleTree(signer.pubKey, publicKeyLeaves))
    // );

    const ciphertext = await encrypt(plaintext, sharedSecret);
    const decryptedCiphertext = await decrypt(ciphertext, sharedSecret);

    console.log("cyper: ", plaintext, " deciphered: ", decryptedCiphertext);
    // await prepareInputs(operator.pubKey, signer.pubKey, signer.privKey, ciphertext);
    // console.log("poolPubKey: ", operator.pubKey);
    // console.log("signerPubKey: ", signer.pubKey);
    // console.log("signerPrivKey: ", signer.privKey);
    // console.log("ciphertext: ", ciphertext);
}

export function JSONStringifyCustom(val: any) {
    return JSON.stringify(
        val,
        (key, value) => (typeof value === "bigint" ? value.toString() : value) // return everything else unchanged
    );
}
