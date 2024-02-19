import { expect } from "chai";
import { Wallet, Provider, Contract, utils } from "zksync-ethers";
import hardhatConfig from "../hardhat.config";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as ethers from "ethers";
import * as hre from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// test pk rich wallet from in-memory node
const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

describe.only("TimeBasedPaymaster", function () {
  let provider: Provider;
  let wallet: Wallet;
  let deployer: Deployer;
  let userWallet: Wallet;
  let paymaster: Contract;
  let greeter: Contract;
  let paymasterAddress: string;

  before(async function () {
    const deployUrl = hardhatConfig.networks.inMemoryNode.url;
    [provider, wallet, deployer] = setupDeployer(deployUrl, PRIVATE_KEY);
    userWallet = Wallet.createRandom();
    console.log(`User wallet's address: ${userWallet.address}`);
    userWallet = new Wallet(userWallet.privateKey, provider);
    paymaster = await deployContract(deployer, "TimeBasedPaymaster", []);
    paymasterAddress = await paymaster.getAddress();
    greeter = await deployContract(deployer, "Greeter", ["Hi"]);
    await fundAccount(wallet, paymasterAddress, "3");
  });

  async function executeGreetingTransaction(user: Wallet) {
    const gasPrice = await provider.getGasPrice();

    const paymasterParams = utils.getPaymasterParams(paymasterAddress, {
      type: "General",
      innerInput: new Uint8Array(),
    });

    await greeter.connect(user);

    const setGreetingTx = await greeter.setGreeting("Hola, mundo!", {
      maxPriorityFeePerGas: BigInt(0),
      maxFeePerGas: gasPrice,
      gasLimit: 6000000,
      customData: {
        gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        paymasterParams,
      },
    });

    await setGreetingTx.wait();
  }

  it("should cost the user no gas during the time window", async function () {
    // Arrange
    const currentDate = new Date();
    currentDate.setUTCHours(14);
    currentDate.setUTCMinutes(1);
    currentDate.setUTCSeconds(0);
    currentDate.setUTCMilliseconds(0);
    const targetTime = Math.floor(currentDate.getTime() / 1000);
    await provider.send("evm_setNextBlockTimestamp", [targetTime]);

    // Act
    const initialBalance = await userWallet.getBalance();
    await executeGreetingTransaction(userWallet);
    await provider.send("evm_mine", []);
    const newBalance = await userWallet.getBalance();

    // Assert
    expect(newBalance.toString()).to.equal(initialBalance.toString());
    expect(await greeter.greet()).to.equal("Hola, mundo!");
  });

  it("should fail due to Paymaster validation error outside the time window", async function () {
    // Arrange
    let errorOccurred = false;

    // Act
    try {
      await executeGreetingTransaction(wallet);
    } catch (error) {
      errorOccurred = true;
      expect(error.message).to.include("Paymaster validation error");
    }

    // Assert
    expect(errorOccurred).to.be.true;
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
