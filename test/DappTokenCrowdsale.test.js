import ether from './helpers/ether';
import EVMRevert from './helpers/EVMRevert';
import { increaseTimeTo, duration } from './helpers/increaseTime';
import latestTime from './helpers/latestTime';

const BigNumber = web3.BigNumber;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

const DappToken = artifacts.require('DappToken');
const DappTokenCrowdsale = artifacts.require('DappTokenCrowdsale');
const RefundVault = artifacts.require('./RefundVault');

contract('DappTokenCrowdsale', function([_, wallet, investor1, investor2]) {

  beforeEach(async function () {
    // Token config
    this.name = "DappToken";
    this.symbol = "DAPP";
    this.decimals = 18;

    // Deploy Token
    this.token = await DappToken.new(
      this.name,
      this.symbol,
      this.decimals
    );

    // Crowdsale config
    this.rate = 500;
    this.wallet = wallet;
    this.cap = ether(100);
    this.openingTime = latestTime() + duration.weeks(1);
    this.closingTime = this.openingTime + duration.weeks(1);
    this.goal = ether(50);

    // Investor caps
    this.investorMinCap = ether(0.002);
    this.inestorHardCap = ether(50);

    // ICO Stages
    this.preIcoStage = 0;
    this.preIcoRate = 500;
    this.icoStage = 1;
    this.icoRate = 250;

    this.crowdsale = await DappTokenCrowdsale.new(
      this.rate,
      this.wallet,
      this.token.address,
      this.cap,
      this.openingTime,
      this.closingTime,
      this.goal
    );

    // Transfer token ownership to crowdsale
    await this.token.transferOwnership(this.crowdsale.address);

    // Add investors to whitelist
    await this.crowdsale.addManyToWhitelist([investor1, investor2]);

    // Track refund vault
    this.vaultAddress = await this.crowdsale.vault();
    this.vault = RefundVault.at(this.vaultAddress);

    // Advance time to crowdsale start
    await increaseTimeTo(this.openingTime + 1);
  });

  describe('crowdsale', function() {
    it('tracks the rate', async function() {
      const rate = await this.crowdsale.rate();
      rate.should.be.bignumber.equal(this.rate);
    });

    it('tracks the wallet', async function() {
      const wallet = await this.crowdsale.wallet();
      wallet.should.equal(this.wallet);
    });

    it('tracks the token', async function() {
      const token = await this.crowdsale.token();
      token.should.equal(this.token.address);
    });
  });

  describe('minted crowdsale', function() {
    it('mints tokens after purchase', async function() {
      const originalTotalSupply = await this.token.totalSupply();
      await this.crowdsale.sendTransaction({ value: ether(1), from: investor1 });
      const newTotalSupply = await this.token.totalSupply();
      assert.isTrue(newTotalSupply > originalTotalSupply);
    });
  });

  describe('capped crowdsale', async function() {
    it('has the correct hard cap', async function() {
      const cap = await this.crowdsale.cap();
      cap.should.be.bignumber.equal(this.cap);
    });
  });

  describe('timed crowdsale', function() {
    it('is open', async function() {
      const isClosed = await this.crowdsale.hasClosed();
      isClosed.should.be.false;
    });
  });

  describe('whitelisted crowdsale', function() {
    it('rejects contributions from non-whitelisted investors', async function() {
      const notWhitelisted = _;
      await this.crowdsale.buyTokens(notWhitelisted, { value: ether(1), from: notWhitelisted }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('refundable crowdsale', function() {
    beforeEach(async function() {
      await this.crowdsale.buyTokens(investor1, { value: ether(1), from: investor1 });
    });

    describe('during crowdsale', function() {
      it('prevents the investor from claiming refund', async function() {
        await this.vault.refund(investor1, { from: investor1 }).should.be.rejectedWith(EVMRevert);
      });
    });

    describe('when the corwdsale stage is PreICO', function() {
      beforeEach(async function () {
        // Crowdsale stage is already PreICO by default
        await this.crowdsale.buyTokens(investor1, { value: ether(1), from: investor1 });
      });

      it('forwards funds to the wallet', async function () {
        const balance = await web3.eth.getBalance(this.wallet);
        expect(balance.toNumber()).to.be.above(ether(100));
      });
    });

    describe('when the crowdsale stage is ICO', function() {
      beforeEach(async function () {
        await this.crowdsale.setCrowdsaleStage(this.icoStage, { from: _ });
        await this.crowdsale.buyTokens(investor1, { value: ether(1), from: investor1 });
      });

      it('forwards funds to the refund vault', async function () {
        const balance = await web3.eth.getBalance(this.vaultAddress);
        expect(balance.toNumber()).to.be.above(0);
      });
    });
  });

  describe('crowdsale stages', function() {

    it('it starts in PreICO', async function () {
      const stage = await this.crowdsale.stage();
      stage.should.be.bignumber.equal(this.preIcoStage);
    });

    it('starts at the preICO rate', async function () {
      const rate = await this.crowdsale.rate();
      rate.should.be.bignumber.equal(this.preIcoRate);
    });

    it('allows admin to update the stage & rate', async function() {
      await this.crowdsale.setCrowdsaleStage(this.icoStage, { from: _ });
      const stage = await this.crowdsale.stage();
      stage.should.be.bignumber.equal(this.icoStage);
      const rate = await this.crowdsale.rate();
      rate.should.be.bignumber.equal(this.icoRate);
    });

    it('prevents non-admin from updating the stage', async function () {
      await this.crowdsale.setCrowdsaleStage(this.icoStage, { from: investor1 }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('accepting payments', function() {
    it('should accept payments', async function() {
      const value = ether(1);
      const purchaser = investor2;
      await this.crowdsale.sendTransaction({ value: value, from: investor1 }).should.be.fulfilled;
      await this.crowdsale.buyTokens(investor1, { value: value, from: purchaser }).should.be.fulfilled;
    });
  });

  describe('buyTokens()', function() {
    describe('when the contribution is less than the minimum cap', function() {
      it('rejects the transaction', async function() {
        const value = this.investorMinCap - 1;
        await this.crowdsale.buyTokens(investor2, { value: value, from: investor2 }).should.be.rejectedWith(EVMRevert);
      });
    });

    describe('when the investor has already met the minimum cap', function() {
      it('allows the investor to contribute below the minimum cap', async function() {
        // First contribution is valid
        const value1 = ether(1);
        await this.crowdsale.buyTokens(investor1, { value: value1, from: investor1 });
        // Second contribution is less than investor cap
        const value2 = 1; // wei
        await this.crowdsale.buyTokens(investor1, { value: value2, from: investor1 }).should.be.fulfilled;
      });
    });
  });

  describe('when the total contributions exceed the investor hard cap', function () {
    it('rejects the transaction', async function () {
      // First contribution is in valid range
      const value1 = ether(2);
      await this.crowdsale.buyTokens(investor1, { value: value1, from: investor1 });
      // Second contribution sends total contributions over investor hard cap
      const value2 = ether(49);
      await this.crowdsale.buyTokens(investor1, { value: value2, from: investor1 }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('when the contribution is within the valid range', function () {
    const value = ether(2);
    it('succeeds & updates the contribution amount', async function () {
      await this.crowdsale.buyTokens(investor2, { value: value, from: investor2 }).should.be.fulfilled;
      const contribution = await this.crowdsale.getUserContribution(investor2);
      contribution.should.be.bignumber.equal(value);
    });
  });









});
