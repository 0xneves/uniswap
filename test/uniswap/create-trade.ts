import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Pool } from '@uniswap/v3-sdk'
import { Route } from '@uniswap/v3-sdk'
import { Trade } from '@uniswap/v3-sdk'
import { CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core'
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { abi as QuoterABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'

interface Immutables {
  factory: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  maxLiquidityPerTick: ethers.BigNumber
}

interface State {
  liquidity: ethers.BigNumber
  sqrtPriceX96: ethers.BigNumber
  tick: number
  observationIndex: number
  observationCardinality: number
  observationCardinalityNext: number
  feeProtocol: number
  unlocked: boolean
}

describe('Pool Creation', function () {
  it('Should create a pool', async function () {
    const { pool, TokenA, TokenB, immutables } = await createPool()
    const trade = await createTrade(immutables, pool, TokenA, TokenB)

    console.log('The unchecked trade object is', trade)
    expect(pool).to.not.be.null
    expect(trade).to.not.be.null
  })
})

async function getPoolContract() {
  const signer = await ethers.getImpersonatedSigner(
    '0x10bf1Dcb5ab7860baB1C3320163C6dddf8DCC0e4',
  )

  const poolAddress = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'

  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI,
    signer,
  )

  return poolContract
}

async function getPoolImmutables() {
  const poolContract = await getPoolContract()

  const [
    factory,
    token0,
    token1,
    fee,
    tickSpacing,
    maxLiquidityPerTick,
  ] = await Promise.all([
    poolContract.factory(),
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
    poolContract.tickSpacing(),
    poolContract.maxLiquidityPerTick(),
  ])

  const immutables: Immutables = {
    factory,
    token0,
    token1,
    fee,
    tickSpacing,
    maxLiquidityPerTick,
  }
  return immutables
}

async function getPoolState() {
  const poolContract = await getPoolContract()

  const [liquidity, slot] = await Promise.all([
    poolContract.liquidity(),
    poolContract.slot0(),
  ])

  const PoolState: State = {
    liquidity,
    sqrtPriceX96: slot[0],
    tick: slot[1],
    observationIndex: slot[2],
    observationCardinality: slot[3],
    observationCardinalityNext: slot[4],
    feeProtocol: slot[5],
    unlocked: slot[6],
  }

  return PoolState
}

async function createPool() {
  const [immutables, state] = await Promise.all([
    getPoolImmutables(),
    getPoolState(),
  ])

  const TokenA = new Token(3, immutables.token0, 6, 'USDC', 'USD Coin')

  const TokenB = new Token(3, immutables.token1, 18, 'WETH', 'Wrapped Ether')

  const pool = new Pool(
    TokenA,
    TokenB,
    immutables.fee,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick,
  )

  return { pool, TokenA, TokenB, immutables, state }
}

async function createTrade(
  immutables: any,
  pool: any,
  TokenA: any,
  TokenB: any,
) {
  const signer = await ethers.getImpersonatedSigner(
    '0x10bf1Dcb5ab7860baB1C3320163C6dddf8DCC0e4',
  )

  const quoterAddress = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'

  const quoterContract = new ethers.Contract(quoterAddress, QuoterABI, signer)
  // assign an input amount for the swap
  const amountIn = 1430

  // call the quoter contract to determine the amount out of a swap, given an amount in
  const quotedAmountOut = await quoterContract.callStatic.quoteExactInputSingle(
    immutables.token0,
    immutables.token1,
    immutables.fee,
    amountIn.toString(),
    0,
  )

  // create an instance of the route object in order to construct a trade object
  const swapRoute = new Route([pool], TokenA, TokenB)

  // create an unchecked trade instance
  const uncheckedTrade = await Trade.createUncheckedTrade({
    route: swapRoute,
    inputAmount: CurrencyAmount.fromRawAmount(TokenA, amountIn.toString()),
    outputAmount: CurrencyAmount.fromRawAmount(
      TokenB,
      quotedAmountOut.toString(),
    ),
    tradeType: TradeType.EXACT_INPUT,
  })

  // print the quote and the unchecked trade instance in the console
  console.log('The quoted amount out is', quotedAmountOut.toString())

  return uncheckedTrade
}
