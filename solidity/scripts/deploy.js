const hre = require("hardhat");
const { main } = require("../../scripts/script")
var fs = require('file-system');

async function deploy() {

  const VLC = await hre.ethers.getContractFactory("VeryLightClient");
  const vlc = await VLC.deploy();

  await vlc.deployed();

  console.log(`vlc deployed`);

  function buf2hex(buffer) { // buffer is an ArrayBuffer
    if (!buffer[0]) return "0000000000000000000000000000000000000000000000000000000000000000"
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
  }

  const packet = JSON.parse(fs.readFileSync('packet.json',{encoding:'utf8', flag:'r'}))
  packet.txRaw = "0x" + buf2hex(packet.txRaw.data)
  // console.log('azeaze', packet.txProof[packet.txProof.length - 1][0].data)
  packet.txRawIndexInTree = Number(packet.txProof[packet.txProof.length - 1][0].data)
  packet.txProof = packet.txProof.map(a => a.map(b => "0x" + buf2hex(b.data)))
  packet.txProof.pop()
  // console.log(packet.txIndex)
  packet.txIndexInBlock = Number(packet.txIndexInBlock)
  packet.blockHeader = packet.blockHeader.map(a => "0x" + buf2hex(a.data))
  console.dir(packet)
  // console.log(packet.txProof[0])
  vlc.mint(packet.txRaw, packet.txRawIndexInTree,
    packet.txProof, packet.txIndexInBlock,
    packet.txRoot, packet.blockHeader, packet.blockHash)
  // console.log("lol")

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
