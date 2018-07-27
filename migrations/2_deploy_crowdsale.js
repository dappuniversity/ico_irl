const DappToken = artifacts.require("./DappToken.sol");

module.exports = function(deployer) {
  const _name = "Dapp Token";
  const _symbol = "DAPP";
  const _decimals = 18;

  deployer.deploy(DappToken, _name, _symbol, _decimals);
};
