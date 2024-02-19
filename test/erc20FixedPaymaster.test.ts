import { expect } from "chai";
import { Wallet, Provider, Contract, utils } from "zksync-ethers";
import hardhatConfig from "../hardhat.config";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as ethers from "ethers";
import * as hre from "hardhat";

// load env file
import dotenv from "dotenv";
dotenv.config();

// test pk rich wallet from in-memory node
const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

describe("ERC20fixedPaymaster", function () {
  let provider: Provider;
  let wallet: Wallet;
  let deployer: Deployer;
  let userWallet: Wallet;
  let ownerInitialBalance: BigInt;
  let paymaster: Contract;
  let greeter: Contract;
  let token: Contract;
  let paymasterAddress: string;
  let tokenAddress: string;
  let greeterAddress: string;

  before(async function () {
    const deployUrl = hardhatConfig.networks.inMemoryNode.url;
    // setup deployer
    [provider, wallet, deployer] = setupDeployer(deployUrl, PRIVATE_KEY);
    // setup new wallet
    const emptyWallet = Wallet.createRandom();
    console.log(`Empty wallet's address: ${emptyWallet.address}`);
    userWallet = new Wallet(emptyWallet.privateKey, provider);
    // deploy contracts
    token = await deployContract(deployer, "MyERC20", ["MyToken", "MyToken", 18]);
    tokenAddress = await token.getAddress();
    paymaster = await deployContract(deployer, "ApprovalPaymaster", [token.address]);
    paymasterAddress = await paymaster.getAddress();
    greeter = await deployContract(deployer, "Greeter", ["Hi"]);
    greeterAddress = await greeter.getAddress();
    // fund paymaster
    await fundAccount(wallet, paymasterAddress, "3");
    ownerInitialBalance = await wallet.getBalance();
  });

  async function executeGreetingTransaction(user: Wallet) {
    const gasPrice = await provider.getGasPrice();
    const token_address = token.address.toString();

    const paymasterParams = utils.getPaymasterParams(paymasterAddress, {
      type: "ApprovalBased",
      token: token_address,
      minimalAllowance: BigInt(1),
      // empty bytes as testnet paymaster does not use innerInput
      innerInput: new Uint8Array(),
    });

    await greeter.connect(user);
    const setGreetingTx = await greeter.setGreeting("Hola, mundo!", {
      maxPriorityFeePerGas: BigInt(0),
      maxFeePerGas: gasPrice,
      // hardcoded for testing
      gasLimit: 6000000,
      customData: {
        gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        paymasterParams,
      },
    });

    await setGreetingTx.wait();

    return wallet.getBalance();
  }

  it("user with MyERC20 token can update message for free", async function () {
    const initialMintAmount = ethers.parseEther("3");
    const success = await token.mint(userWallet.address, initialMintAmount);
    await success.wait();

    const userInitialTokenBalance = await token.balanceOf(userWallet.address);
    const userInitialETHBalance = await userWallet.getBalance();
    const initialPaymasterBalance = await provider.getBalance(paymasterAddress);

    await executeGreetingTransaction(userWallet);

    const finalETHBalance = await userWallet.getBalance();
    const finalUserTokenBalance = await token.balanceOf(userWallet.address);
    const finalPaymasterBalance = await provider.getBalance(paymasterAddress);

    expect(await greeter.greet()).to.equal("Hola, mundo!");
    expect(initialPaymasterBalance).to.be.gt(finalPaymasterBalance);
    expect(userInitialETHBalance).to.eql(finalETHBalance);
    expect(userInitialTokenBalance.gt(finalUserTokenBalance)).to.be.true;
  });

  it("should allow owner to withdraw all funds", async function () {
    try {
      await paymaster.connect(wallet)
      const tx = await paymaster.withdraw(userWallet.address);
      await tx.wait();
    } catch (e) {
      console.error("Error executing withdrawal:", e);
    }

    const finalContractBalance = await provider.getBalance(paymasterAddress);

    expect(finalContractBalance).to.eql(BigInt(0));
  });

  it("should prevent non-owners from withdrawing funds", async function () {
    try {
      await paymaster.connect(userWallet)
      await paymaster.withdraw(userWallet.address);
    } catch (e) {
      expect(e.message).to.include("Ownable: caller is not the owner");
    }
  });

    async function deployContract(deployer: Deployer, contract: string, params: any[]): Promise<Contract> {
    const artifact = await deployer.loadArtifact(contract);
    return await deployer.deploy(artifact, params);
  }

  async function fundAccount(wallet: Wallet, address: string, amount: string) {
    await (await wallet.sendTransaction({ to: address, value: ethers.parseEther(amount) })).wait();
  }

  function setupDeployer(url: string, privateKey: string): [Provider, Wallet, Deployer] {
    const provider = new Provider(url);
    const wallet = new Wallet(privateKey, provider);
    const deployer = new Deployer(hre, wallet);
    return [provider, wallet, deployer];
  }
});
