import { expect } from 'chai'
import { ethers } from 'hardhat'
import { AlphaRouter } from '@uniswap/smart-order-router'
import {
  Token,
  TradeType,
  Percent,
  Currency,
  CurrencyAmount,
} from '@uniswap/sdk-core'
import { BigNumber } from 'ethers'
import { abi } from '../../src/abi/erc20-abi'

const expandDecimals = (currency: Currency, amount: number): number => {
  return amount * 10 ** currency.decimals
}

describe('Auto Router', function () {
  it('Should find a route and buy USDC with WETH, after approving spending', async function () {
    const signer = await ethers.getImpersonatedSigner(
      '0x83D1b0d9169520793a56F870F473b00307EFe766',
    )

    const aave = new ethers.Contract(
      '0xC13eac3B4F9EED480045113B7af00F7B5655Ece8',
      abi,
      ethers.provider,
    )
    const tx = await aave.balanceOf(
      '0x4da27a545c0c5b758a6ba100e3a049001de870f5',
    )
    console.log('amount', tx.toString())
    console.log('address', await aave.totalSupply())
    console.log(await aave.decimals())

    const tx2 = await createRouter(signer)

    expect(tx2).to.not.be.null
  }).timeout(10000000)
})

async function createRouter(signer: any) {
  const V3_SWAP_ROUTER_ADDRESS = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
  const MY_ADDRESS = signer.address
  const tradeType = TradeType.EXACT_INPUT

  const router = new AlphaRouter({ chainId: 1, provider: ethers.provider })

  const tokenIn = new Token(
    1,
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    18,
    'WETH',
    'Wrapped Ether',
  )

  const tokenOut = new Token(
    1,
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    6,
    'USDC',
    'USD//C',
  )
  const amount = 1
  const currencyAmount = CurrencyAmount.fromRawAmount(
    tokenIn,
    expandDecimals(tokenIn, amount),
  )

  const route = await router.route(currencyAmount, tokenOut, tradeType, {
    recipient: MY_ADDRESS,
    slippageTolerance: new Percent(5, 100),
    deadline: Math.floor(Date.now() / 1000 + 1800),
  })
  if (route == null) {
    return null
  }

  console.log(`Quote Exact In: ${route.quote.toFixed(2)}`)
  console.log(`Gas Adjusted Quote In: ${route.quoteGasAdjusted.toFixed(2)}`)
  console.log(`Gas Used USD: ${route.estimatedGasUsedUSD.toFixed(6)}`)

  if (route.methodParameters == null) {
    return null
  }

  const transaction = {
    data: route.methodParameters.calldata,
    to: V3_SWAP_ROUTER_ADDRESS,
    value: BigNumber.from(route.methodParameters.value),
    from: MY_ADDRESS,
    gasPrice: BigNumber.from(route.gasPriceWei),
    gasLimit: 3000000,
  }

  const approvalAmount = ethers.utils
    .parseUnits(amount.toString(), 18)
    .toString()

  const WETHContract = new ethers.Contract(
    tokenIn.address,
    abi,
    ethers.provider,
  )
  await WETHContract.connect(signer).approve(
    V3_SWAP_ROUTER_ADDRESS,
    approvalAmount,
  )

  const balanceBefore = await WETHContract.balanceOf(MY_ADDRESS)

  const tx = await signer.sendTransaction(transaction)

  const balanceAfter = await WETHContract.balanceOf(MY_ADDRESS)

  const resultadoDif = balanceBefore.sub(balanceAfter)

  expect(Number(ethers.utils.formatEther(resultadoDif))).to.be.equal(amount)

  return tx
}
