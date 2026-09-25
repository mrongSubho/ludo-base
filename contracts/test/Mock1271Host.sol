// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1271} from "../src/interfaces/IERC1271.sol";

/// @dev Test double: accepts any signature whose `owner` signed the digest via ecrecover,
///      or a raw owner ECDSA 65-byte sig where owner == expected signer of the wrapper.
///      Simplest contract wallet: stores one owner and forwards ERC-1271 checks.
contract Mock1271Host is IERC1271 {
    address public owner;
    bytes32 public lastHash;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length != 65) return bytes4(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        address recovered = ecrecover(hash, v, r, s);
        if (recovered == owner) return IERC1271.isValidSignature.selector;
        return bytes4(0);
    }
}
