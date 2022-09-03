const { ethers } = require("ethers");
const Tree = require('merkle-patricia-tree')
const { keccak, encode, decode, toBuffer, toWord } = require('eth-util-lite')
const { Header, Proof, Transaction } = require('eth-object')
const { promisfy } = require('promisfy')
const Rpc  = require('isomorphic-rpc')
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
require('dotenv').config()


const rpcUrl = "https://mainnet.infura.io/v3/49f373294ecd4358abd6a39d55521529"
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

const TXS_ROOT_INDEX = 4 // within header

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

  static async proofContainsValueAt(proof, path){
    return new Promise((accept, reject) => {
      let encodedProof = []

      for (let i = 0; i < proof.length; i++) {
        encodedProof.push(encode(proof[i]))
      }

      Tree.verifyProof(toBuffer(this.getRootFromProof(proof)) , path, encodedProof, (e,r)=>{
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
    //   this.rpc = new ethers.providers.JsonRpcProvider(rpcProvider)
      this.eth_getProof = this.rpc.eth_getProof
    }

    async getTxFromTxHash(txHash) {
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
      let resp = await this.get.transactionProof(txHash)
      console.log('resp.header', resp.header)
      let blockHashFromHeader = VerifyProof.getBlockHashFromHeader(resp.header)
      if(!toBuffer(trustedBlockHash).equals(blockHashFromHeader)) throw new Error('BlockHash mismatch')
      let txRootFromHeader = VerifyProof.getTxsRootFromHeader(resp.header)
      let txRootFromProof = VerifyProof.getRootFromProof(resp.txProof)
      if(!txRootFromHeader.equals(txRootFromProof)) throw new Error('TxRoot mismatch')
      return VerifyProof.getTxFromTxProofAt(resp.txProof, resp.txIndex)
    }

    async getPacket(txHash){
        const tx = await this.get.getTxFromTxHash(txHash)
        const txRaw = await this.get.getRawTxFromTxHash(tx)
        const resp = await this.get.transactionProof(txHash)
        const block = await this.get.getBlockFromBlockHash(tx.blockHash)
        // block.transactions = null
        // console.log('block', block)

        return {
            txRaw: txRaw, // Buffer(172) [Uint8Array]
            txProof: resp.txProof, // Proof(5) [[Buffer [Uint8Array]]]
            txRoot: block.transactionsRoot, // string
            blockHeader: resp.header, // Header(15) [Buffer(32) [Uint8Array] ]
            blockHash: block.hash, // string
        }
    }
}

async function constructPacket(txHash) {
    const getAndVerify = new GetAndVerify(rpcUrl)
    // getAndVerify.txAgainstBlockHash(untrustedTxHash, blockHashThatITrust)
    const packet = await getAndVerify.getPacket(txHash)
    // console.log("packet :")
    // console.dir(packet)
    return packet
}

async function main() {
    // const packet = constructPacket("0x07830e591c3bbd1f107cf422648e80f0b44e13067cb6ea4e7696a8b5a4c01380")
    
    const wsProvider = new WsProvider('wss://ws.test.azero.dev');
    const api = await ApiPromise.create({ provider: wsProvider })
    const keyring = new Keyring({ type: 'sr25519' });
    const me = keyring.addFromUri(process.env.SEED_PHRASE);

    const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

    const transfer = api.tx.balances.transfer(BOB, 12345);
    const hash = await transfer.signAndSend(me);
    console.log('Transfer sent with hash', hash.toHex());

    
}

main().then(() => process.exit())