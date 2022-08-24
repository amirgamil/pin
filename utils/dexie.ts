// dexie.ts
import { DexieDatabase, ISigner } from "@utils/types";

export const db = new DexieDatabase();

export async function addOperatorDataToCache(
  commitmentPoolId: string,
  operatorPublicKey: string,
  operatorId: string,
  hashedOperatorUserId: string,
  operatorPrivateKey?: string
) {
  try {
    let pool = await db.commitmentPools.get({
      commitmentPoolId: commitmentPoolId,
    });

    if (!pool) {
      await db.commitmentPools.add({
        commitmentPoolId: commitmentPoolId,
        operatorPublicKey: operatorPublicKey,
        operatorId: operatorId,
        hashedOperatorUserId: hashedOperatorUserId,
        operatorPrivateKey: operatorPrivateKey,
        signers: [],
      });
    }
  } catch (error) {
    console.log(`Failed to add ${commitmentPoolId}: ${error}`);
  }
}

export async function addSignerDataToCommitmentPoolInCache(
  commitmentPoolId: string,
  signerPubKey: string
) {
  try {
    await db.commitmentPools
      .where("commitmentPoolId")
      .equals(commitmentPoolId)
      .modify((entry) => {
        entry.signers.push({ publicKey: signerPubKey });
      });
  } catch (error) {
    console.log(`Failed to add signer to ${commitmentPoolId}: ${error}`);
    return undefined;
  }
}

export async function getCachedCommitmentPoolData(commitmentPoolId: string) {
  try {
    let pool = await db.commitmentPools.get({
      commitmentPoolId: commitmentPoolId,
    });

    return pool;
  } catch (error) {
    console.log(`Failed to get ${commitmentPoolId}: ${error}`);
    return undefined;
  }
}

export async function getCachedSignerData(hashedUserId: string) {
  try {
    let signers = await db.signers.get({
      hashedUserId: hashedUserId,
    });

    return signers;
  } catch (error) {
    console.log(`Failed to get ${hashedUserId}: ${error}`);
    return undefined;
  }
}

export async function addSignerDataToCache(
  hashedUserId: string,
  pubKey: string,
  privKey: string
) {
  try {
    let signer = await db.signers.get({
      hashedUserId: hashedUserId,
    });

    if (!signer) {
      await db.signers.add({
        hashedUserId,
        privateKey: privKey,
        publicKey: pubKey,
      });
    }
  } catch (error) {
    console.log(`Failed to add ${hashedUserId} to signers list s: ${error}`);
  }
}
