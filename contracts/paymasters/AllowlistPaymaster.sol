// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPaymaster, ExecutionResult, PAYMASTER_VALIDATION_SUCCESS_MAGIC} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymaster.sol";
import {IPaymasterFlow} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymasterFlow.sol";
import {TransactionHelper, Transaction} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";

import "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

/// @author Matter Labs
/// @notice This contract does not include any validations other than using the paymaster general flow.
contract AllowlistPaymaster is IPaymaster, Ownable {
    // The paymaster will pay the gas fee for the accounts in allowList
    mapping(address => bool) public allowList;
    // Emits events when list has been updated
    event UpdateAllowlist(address _target, bool _allowed);

    constructor() {
        // adds owner to allow list
        allowList[msg.sender] = true;
    }

    modifier onlyBootloader() {
        require(
            msg.sender == BOOTLOADER_FORMAL_ADDRESS,
            "Only bootloader can call this method"
        );
        // Continue execution if called from the bootloader.
        _;
    }

    function validateAndPayForPaymasterTransaction(
        bytes32,
        bytes32,
        Transaction calldata _transaction
    )
        external
        payable
        onlyBootloader
        returns (bytes4 magic, bytes memory context)
    {
        // By default we consider the transaction as accepted.
        magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
        require(
            _transaction.paymasterInput.length >= 4,
            "The standard paymaster input must be at least 4 bytes long"
        );

        bytes4 paymasterInputSelector = bytes4(
            _transaction.paymasterInput[0:4]
        );
        if (paymasterInputSelector == IPaymasterFlow.general.selector) {
            // extract the address from the Transaction object
            address userAddress = address(uint160(_transaction.from));

            // checks if account is in allowList
            bool isAllowed = allowList[userAddress];
            // validates if address is on the allowList
            require(isAllowed, "Account is not in allow list");

            // Note, that while the minimal amount of ETH needed is tx.gasPrice * tx.gasLimit,
            // neither paymaster nor account are allowed to access this context variable.
            uint256 requiredETH = _transaction.gasLimit *
                _transaction.maxFeePerGas;

            // The bootloader never returns any data, so it can safely be ignored here.
            (bool success, ) = payable(BOOTLOADER_FORMAL_ADDRESS).call{
                value: requiredETH
            }("");
            require(
                success,
                "Failed to transfer tx fee to the Bootloader. Paymaster balance might not be enough."
            );
        } else {
            revert("Unsupported paymaster flow in paymasterParams.");
        }
    }

    function postTransaction(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32,
        bytes32,
        ExecutionResult _txResult,
        uint256 _maxRefundedGas
    ) external payable override onlyBootloader {}

    function withdraw(address payable _to) external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = _to.call{value: balance}("");
        require(success, "Failed to withdraw funds from paymaster.");
    }

    receive() external payable {}

    function setBatchAllowance(
        address[] calldata _targets,
        bool[] calldata _allowances
    ) external onlyOwner {
        uint256 targetsLength = _targets.length;
        require(
            targetsLength == _allowances.length,
            "Account and permission lists should have the same length"
        ); // The size of arrays should be equal

        for (uint256 i = 0; i < targetsLength; i++) {
            _setAllowance(_targets[i], _allowances[i]);
        }
    }

    function _setAllowance(address _target, bool _allowed) internal {
        bool isAllowed = allowList[_target];

        if (isAllowed != _allowed) {
            allowList[_target] = _allowed;
            emit UpdateAllowlist(_target, _allowed);
        }
    }
}
