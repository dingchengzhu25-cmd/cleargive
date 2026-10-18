import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile() {
  const input = { language: 'Solidity', sources: Object.fromEntries(['ClearGive.sol', 'ClearGiveFees.sol', 'ClearGiveXSGD.sol'].map(name => [name, {content: fs.readFileSync('contracts/' + name, 'utf8')}])), settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: name => { try { return { contents: fs.readFileSync(path.join('node_modules', name), 'utf8') }; } catch { return { error: `Missing import ${name}` }; } } }));
  const errors = (output.errors || []).filter(x => x.severity === 'error');
  if (errors.length) throw new Error(errors.map(x => x.formattedMessage).join('\n'));
  const contracts = Object.fromEntries(Object.values(output.contracts).flatMap(file => Object.entries(file)).map(([name, value]) => [name, { abi: value.abi, bytecode: `0x${value.evm.bytecode.object}` }]));
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/contracts.json', JSON.stringify(contracts));
  return contracts;
}
