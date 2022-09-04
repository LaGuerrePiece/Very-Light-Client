// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "hardhat/console.sol";

contract VeryLightClient {

    bytes32 trustedBlockHash;

    constructor(bytes32 _trustedBlockHash) {
        trustedBlockHash = _trustedBlockHash;
    }

    function mint(
        bytes memory _txRaw,
        uint256 _txIndexInTrie,
        bytes32[][] memory _txProof,
        uint256 _txIndexInBlock,
        bytes32 _txRoot, bytes[] memory _blockHeader, bytes32 _blockHash
    ) public {
        bytes32 txHash = keccak256(abi.encodePacked(_txRaw));
        // bytes32 hash2 = 0x07830e591c3bbd1f107cf422648e80f0b44e13067cb6ea4e7696a8b5a4c01380;

        // require(hash == hash2, "txHashFromRawTx !== txHashFromProof");

        require(bytes32(_blockHeader[4]) == _txRoot, "_blockHeader[4] != _txRoot" );
        // bytes32 blockHashFromHeader = keccak256(abi.encodePacked(_blockHeader));
        // require(blockHashFromHeader == _blockHash, "blockHashFromHeader == _blockHash");
        

    }
}
