const { ethers } = require("ethers");
const Tree = require('merkle-patricia-tree')
const { keccak, encode, decode, toBuffer, toWord } = require('eth-util-lite')
const { Header, Proof, Transaction } = require('eth-object')
const { promisfy } = require('promisfy')
const Rpc  = require('isomorphic-rpc')
// const { ApiPromise, WsProvider } = require('@polkadot/api');
// const { Keyring } = require('@polkadot/keyring');
require('dotenv').config()
var fs = require('file-system');


const rpcUrl = "https://mainnet.infura.io/v3/49f373294ecd4358abd6a39d55521529"
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

const TXS_ROOT_INDEX = 4 // within header

// async function aleph() {
//   const wsProvider = new WsProvider('wss://ws.test.azero.dev');
//   const api = await ApiPromise.create({ provider: wsProvider })
//   const keyring = new Keyring({ type: 'sr25519' });
//   const me = keyring.addFromUri(process.env.SEED_PHRASE);

//   const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

//   const transfer = api.tx.balances.transfer(BOB, 12345);
//   const hash = await transfer.signAndSend(me);
//   console.log('Transfer sent with hash', hash.toHex());

// }

class VerifyProof {

  static getRootFromProof(proof){ return keccak(encode(proof[0])) }

  static getBlockHashFromHeader(header){
    return keccak(encode(header))
  }
  static getElemFromHeaderAt(header, indexOfRoot){
    return header[indexOfRoot]
  }
  static getTxsRootFromHeader(header){
    return this.getElemFromHeaderAt(header, TXS_ROOT_INDEX)
  }

  static async getTxFromTxProofAt(proof, indexOfTx){
    let txBuffer = await this.proofContainsValueAt(proof, encode(indexOfTx))
    return Transaction.fromBuffer(txBuffer)
  }

  // checks if the proof 
  static async proofContainsValueAt(proof, path){
    return new Promise((accept, reject) => {
      let encodedProof = []

      for (let i = 0; i < proof.length; i++) {
        encodedProof.push(encode(proof[i]))
      }

      Tree.verifyProof(toBuffer(this.getRootFromProof(proof)), path, encodedProof, (e,r)=>{
        if(e){
          return reject(e)
        }else{
          return accept(r)
        }
      })
    })
  }
}

class GetProof{

    constructor(rpcProvider){
      this.rpc = new Rpc(rpcProvider)
      this.eth_getProof = this.rpc.eth_getProof
    }

    async getTxFromTxHash(txHash) {
        // console.log('tx', await this.rpc.eth_getTransactionByHash(txHash))
        return await this.rpc.eth_getTransactionByHash(txHash)
    }

    async getRawTxFromTxHash(tx) {
        return Transaction.fromRpc(tx).serialize()
    }

    async getBlockFromBlockHash(blockHash) {
        return await this.rpc.eth_getBlockByHash(blockHash, true)
    }
  
    async transactionProof(txHash){
      let targetTx = await this.rpc.eth_getTransactionByHash(txHash)
      if(!targetTx){ throw new Error("Tx not found. Use archive node")}
  
      let rpcBlock = await this.rpc.eth_getBlockByHash(targetTx.blockHash, true)
  
      let tree = new Tree();
      
      await Promise.all(rpcBlock.transactions.map((siblingTx, index) => {
          let siblingPath = encode(index)
          let serializedSiblingTx = Transaction.fromRpc(siblingTx).serialize()
          return promisfy(tree.put, tree)(siblingPath, serializedSiblingTx) 
        }))

      let [_,__,stack] = await promisfy(tree.findPath, tree)(encode(targetTx.transactionIndex))
      // console.log('stack', stack)
      // console.log('txProof:', Proof.fromStack(stack),)
  
      return {
        header: Header.fromRpc(rpcBlock),
        txProof: Proof.fromStack(stack),
        txIndex: targetTx.transactionIndex,
      }
    }
}

class GetAndVerify {

    constructor(rpcProvider){
      this.get = new GetProof(rpcProvider)
    }
  
    async txAgainstBlockHash(txHash, trustedBlockHash){
      // generates the proof : header, txProof, txIndex by calling RPC
      let resp = await this.get.transactionProof(txHash)
      // gets the blockHash from the header and compares it to the real one
      let blockHashFromHeader = VerifyProof.getBlockHashFromHeader(resp.header)
      if(!toBuffer(trustedBlockHash).equals(blockHashFromHeader)) throw new Error('BlockHash mismatch')
      // extracts txsRoot from header
      let txRootFromHeader = VerifyProof.getTxsRootFromHeader(resp.header)
      // checks if txRoot given in proof is the same as in the header
      let txRootFromProof = VerifyProof.getRootFromProof(resp.txProof)
      if(!txRootFromHeader.equals(txRootFromProof)) throw new Error('TxRoot mismatch')
      // at the given index, 
      return VerifyProof.getTxFromTxProofAt(resp.txProof, resp.txIndex)
    }

    async getPacket(txHash){
        const tx = await this.get.getTxFromTxHash(txHash)
        const txRaw = await this.get.getRawTxFromTxHash(tx)
        const resp = await this.get.transactionProof(txHash)
        const block = await this.get.getBlockFromBlockHash(tx.blockHash)

        return {
            txRaw: txRaw, // Buffer(172) [Uint8Array]
            txRawIndexInTree: resp.txRawIndexInTree, // uint256
            txProof: resp.txProof, // Proof(5) [[Buffer [Uint8Array]]]
            txIndexInBlock: resp.txIndex, // uint256
            txRoot: block.transactionsRoot, // string
            blockHeader: resp.header, // Header(15) [Buffer(32) [Uint8Array] ]
            blockHash: block.hash, // string
        }
    }
}

async function checkPacket(packet) {
  // VERIFY that txHash declared = keccak256(txRaw)
  const txHashFromRawTx = keccak(packet.txRaw)
  const txHashFromProof = await VerifyProof.getTxFromTxProofAt(packet.txProof, packet.txIndex)
  if (txHashFromRawTx !== txHashFromProof) {
    console.log('error, txHashFromRawTx !== txHashFromProof', txHashFromRawTx, txHashFromProof)
    return
  }

  // VERIFY that txRoot declared = keccak (txHash + txProof)
  let encodedProof = []
  for (let i = 0; i < packet.txProof.length; i++) {
    encodedProof.push(encode(packet.txProof[i]))
  }
  
  Tree.verifyProof(toBuffer(packet.txRoot), encode(packet.txIndex), encodedProof, (e,r)=>{
    if(e){
      return reject(e)
    }else{
      return accept(r)
    }
  })
  // Verifie that proof[0] == packet.txRoot ?

  // VERIFY that txRoot declared is same as txRoot from Header
  let txRootFromHeader = VerifyProof.getTxsRootFromHeader(packet.blockHeader)
  if (txRootFromHeader !== packet.txRoot) {
    console.log('error, txRootFromHeader !== packet.txRoot', txRootFromHeader, packet.txRoot)
    return
  }

  // VERIFY that blockHeader provided hashed gives blockHash provided
  let blockHashFromHeader = VerifyProof.getBlockHashFromHeader(packet.blockHeader)
  if(!toBuffer(packet.blockHash).equals(blockHashFromHeader)) throw new Error('BlockHash mismatch')

  // CHECK txRaw.amount == _amount, txRaw.to == bridgeContract, txRaw.method == lock
  // CHECK blockHash == relayedBlockHash

  

}

async function main() {
  const getAndVerify = new GetAndVerify(rpcUrl)
  const packet = await getAndVerify.getPacket("0x07830e591c3bbd1f107cf422648e80f0b44e13067cb6ea4e7696a8b5a4c01380")  
  
  try {
    fs.writeFileSync(
      "packet.json",
      JSON.stringify(packet)
    );
  } catch (e) {
    console.log(e);
  }

  
  // return packet
  // const result = await getAndVerify.txAgainstBlockHash('0x9a53763091ca131d88ed155946f3ff8e739003737e8cab3dde9a380f26f4bbd8', "0xb06e1746f418625d5d44a591d0e71525beebfb2fb0c17d82d719d60d860be982")
  // console.log('packet', packet)
  // console.log('result :')
  // await checkPacket(packet)
  // console.log('result', result)
  // const getProof = new GetProof(rpcUrl)
  // console.log('tx', await getProof.getTxFromTxHash("0x07830e591c3bbd1f107cf422648e80f0b44e13067cb6ea4e7696a8b5a4c01380"))
}

main().then(() => process.exit())

// module.exports = {
//   main
// }