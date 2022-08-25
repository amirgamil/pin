import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import prisma from "@utils/prisma";
import { CommitmentPoolProps, ISignature, ProofInput } from "@utils/types";
import { GetServerSideProps, NextPage } from "next";
import styles from "@styles/Home.module.css";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  decryptCipherTexts,
  generateCircuitInputs,
  getPublicKeyFromPrivate,
  serializePubKey,
} from "@utils/crypto";
import { generateProof } from "@utils/zkp";
import { checkCachedSignerData, setSignature, updateUserPublicKey } from "@utils/api";
import { useLiveQuery } from "dexie-react-hooks";
import { addOperatorDataToCache, getCachedSignerData, getCachedCommitmentPoolData, addSignerDataToCommitmentPoolInCache, addSignerDataToCache } from '@utils/dexie';
import { useRouter } from "next/router";

const CommitmentPool: NextPage<CommitmentPoolProps> = (props) => {
  const { data: session } = useSession();

  const [isOperator, setIsOperator] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [alreadySigned, setAlreadySigned] = useState(false);

  const toast = useToast();
  const router = useRouter();

  const cachedCommitmentPoolData = useLiveQuery(
    async () => {
      if (!session) { return; }
      const operatorData = await getCachedCommitmentPoolData(props.id)
      return operatorData;
    }, [session]);

  const cachedSigner = useLiveQuery(
    async () => {
      if (!session) { return; }
      // @ts-ignore TODO:
      const signerData = await getCachedSignerData(session.user.id);
      return signerData;
    }, [session, session?.user]);

  // figure out if current user is the operator
  useEffect(() => {
    if (!session || !session.user || !props.id) {
      setIsOperator(false);
      return;
    }
    const operatorUserId = cachedCommitmentPoolData?.operatorUserId;
    if (!operatorUserId) { setIsOperator(false); return; }

    // @ts-ignore TODO:
    if (session.user.id === operatorUserId) {
      setIsOperator(true);
    }
  }, [setIsOperator, session, props.id, cachedCommitmentPoolData]);

  // figure out if this attestation has already been signed
  // only works for local signers (if you signed from the same device)
  useEffect(() => {
    if (!cachedSigner || !cachedCommitmentPoolData) { return; }
    if (cachedCommitmentPoolData.localSigners && cachedCommitmentPoolData.localSigners.length !== 0 &&
      cachedCommitmentPoolData.localSigners.filter((signer) => signer.publicKey === cachedSigner.publicKey)) {
      setAlreadySigned(true);
    } else {
      setAlreadySigned(false);
    }
  }, [cachedCommitmentPoolData, cachedCommitmentPoolData?.localSigners, cachedSigner, props.id, setAlreadySigned]);

  useEffect(() => {
    if (session && cachedSigner) {
      checkCachedSignerData(cachedSigner, session, toast);
    }
  }, [cachedSigner, cachedSigner?.privateKey, session, toast]);

  const refreshData = () => {
    router.replace(router.asPath);
  };

  const signAttestation = async () => {
    try {
      setIsLoading(true);
      if (!session || !session.user || !cachedSigner?.privateKey) {
        toast({
          title: "Uh oh something went wrong, can you try again?",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
        setIsLoading(false);
        return;
      }

      //get signer private key
      const privKey = cachedSigner.privateKey;
      const serializedOpPubKey = props.operator.operator_key;
      const serializedPublicKeys: string[] = props.serializedPublicKeys;

      if (!privKey || serializedPublicKeys?.find((key) => !key)) {
        setIsLoading(false);
        return;
      }

      const circuitInput: ProofInput = await generateCircuitInputs(
        serializedOpPubKey,
        privKey,
        serializedPublicKeys,
        Number(props.id)
      );

      const { proof, publicSignals } = await generateProof(circuitInput);
      const res = await setSignature(proof, publicSignals, circuitInput.ciphertext, props.id);
      if (res.status === 200) {
        await refreshData();
        toast({
          title: "Successfully signed and generated proof.",
          status: "success",
          duration: 3000,
          isClosable: true,
        });
        addSignerDataToCommitmentPoolInCache(props.id, cachedSigner.publicKey);
      } else {
        toast({
          title: "Looks like you've already signed before",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
      }
      setIsLoading(false);
    } catch (err: unknown) {
      console.error(err);
      toast({
        title: "Uh oh something went wrong",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      setIsLoading(false);
    }
  };

  // validation schema
  const submitPrivateKeySchema = Yup.object().shape({
    privateKey: Yup.string().length(77, "invalid length").required("Required"),
  });

  // submit operator private key form
  const submitPrivateKeyForm = useFormik({
    initialValues: {
      privateKey: "",
    },
    validationSchema: submitPrivateKeySchema,
    onSubmit: async (values) => {
      if (!session) { return; }
      const privKey = values.privateKey;
      const derivedPubKey = await getPublicKeyFromPrivate(privKey);
      const res = await fetch(`/api/operator/${props.operatorId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const content = await res.json();
      if (content.operator_key === derivedPubKey) {
        setIsOperator(true);
        // @ts-ignore TODO:
        addOperatorDataToCache(props.id, content.operator_key, content.id, session.user.id, privKey);
      }
    },
  });

  const startReveal = () => {
    if (!isOperator || !cachedCommitmentPoolData?.operatorPrivateKey) { return; }
    decryptCipherTexts(cachedCommitmentPoolData?.operatorPrivateKey, props.serializedPublicKeys, props.signatures)
  }

  return (
    <Box className={styles.container}>
      <Box className={styles.main}>
        <VStack gap={4}>
          <Text as="h1" textAlign="center">
            {props.title}
          </Text>
          <Text>
            Created at: {new Date(Date.parse(props.created_at)).toDateString()}{" "}
            {new Date(Date.parse(props.created_at)).toLocaleTimeString()}{" "}
          </Text>
          <Text>
            {props.signatures.length || 0}/{props.threshold} signatures
          </Text>
          {!session && <Text color="gray.600">Please sign in to attest</Text>}
          {!alreadySigned ? (
            <Button disabled={!session} onClick={signAttestation}>
              Sign attestation
            </Button>
          ) :
            (<Button disabled>Already signed!</Button>)}
          {(isOperator && props.signatures.length < props.threshold) &&
            <Box background="orange.50" padding={4} borderRadius={8}>
              <Text>Welcome back! You need to wait until the threshold has been reached to reveal. Come back later.
              </Text>
            </Box>}
          {(isOperator && props.signatures.length >= props.threshold) &&
            <VStack background="green.50" padding={4} borderRadius={8}>
              <Text>Hi {session?.user?.name}, This commitment pool is ready for reveal.</Text>
              <Button onClick={startReveal}>Reveal</Button>
            </VStack>}
          {isLoading && <Spinner />}
          {!isOperator && <VStack background="gray.50" padding={4} borderRadius={8}>
            <Text color="gray.600">
              {`Are you the operator? Sorry, we didn't recognize you but if you have your key pair handy we can sign you back in as an operator.`}
            </Text>
            <form
              onSubmit={submitPrivateKeyForm.handleSubmit}
              style={{ width: "100%", maxWidth: "1000px" }}
            >
              <VStack
                textAlign="start"
                justifyContent="start"
                alignContent="start"
              >
                {submitPrivateKeyForm.errors.privateKey && (
                  <Text color="red.400">
                    *{submitPrivateKeyForm.errors.privateKey}
                  </Text>
                )}
                <HStack width="100%">
                  <Input
                    id="privateKey"
                    name="privateKey"
                    type="text"
                    placeholder="private key (make sure to check the URL is zkpin.xyz, be careful where you share this)"
                    onChange={submitPrivateKeyForm.handleChange}
                    value={submitPrivateKeyForm.values.privateKey}
                  />
                  <Button type="submit" disabled={!session}>
                    Submit
                  </Button>
                </HStack>
              </VStack>
            </form>
          </VStack>
          }
        </VStack>
      </Box>
    </Box>
  );
};

//TODO: type props
export const getServerSideProps: GetServerSideProps = async ({
  params,
}): Promise<any> => {
  const pool = await prisma.commitmentPool.findUnique({
    where: {
      id: Number(params?.id) || -1,
    },
    select: {
      id: true,
      title: true,
      description: true,
      created_at: true,
      threshold: true,
      operator: {
        select: {
          operator_key: true,
        },
      },
    },
  });

  // global public keys
  const sybilAddresses = {
    serializedPublicKeys: (
      await prisma.user.findMany({
        select: {
          serializedPublicKey: true,
        },
      })
    ).map((el) => el.serializedPublicKey),
  };

  const signatures = await prisma.signature.findMany({
    where: {
      commitment_poolId: pool?.id,
    },
    select: {
      ciphertext: true
    },
  });

  if (signatures.length >= (pool?.threshold || 0)) {
    return {
      props: {
        ...JSON.parse(JSON.stringify(pool)),
        ...JSON.parse(JSON.stringify(sybilAddresses)),
        signatures: JSON.parse(JSON.stringify(signatures)),
      },
    };
  } else {
    return {
      props: {
        ...JSON.parse(JSON.stringify(pool)),
        ...JSON.parse(JSON.stringify(sybilAddresses)),
        signatures: signatures.map(() => ''),
      },
    };
  }

};

export default CommitmentPool;
