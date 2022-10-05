import {
  Currency,
  CurrencyAmount,
  Ether,
  Percent,
  Token,
  TradeType,
} from '@uniswap/sdk-core'
import {
  AlphaRouter,
  AlphaRouterConfig,
  CachingV3PoolProvider,
  CEUR_CELO,
  CEUR_CELO_ALFAJORES,
  ChainId,
  CUSD_CELO,
  CUSD_CELO_ALFAJORES,
  DAI_MAINNET,
  DAI_ON,
  FallbackTenderlySimulator,
  ID_TO_NETWORK_NAME,
  ID_TO_PROVIDER,
  MixedRoute,
  nativeOnChain,
  NATIVE_CURRENCY,
  NodeJSCache,
  OnChainQuoteProvider,
  parseAmount,
  SUPPORTED_CHAINS,
  UniswapMulticallProvider,
  UNI_GÖRLI,
  UNI_MAINNET,
  USDC_ETHEREUM_GNOSIS,
  USDC_MAINNET,
  USDC_ON,
  USDT_MAINNET,
  V2PoolProvider,
  V2Route,
  V2_SUPPORTED,
  V3PoolProvider,
  V3Route,
  WBTC_GNOSIS,
  WBTC_MOONBEAM,
  WETH9,
  WNATIVE_ON,
} from '@uniswap/smart-order-router'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  encodeSqrtRatioX96,
  FeeAmount,
  MethodParameters,
  Pool,
} from '@uniswap/v3-sdk'
import { BigNumber, providers } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import NodeCache from 'node-cache'
import {
  getBalanceAndApprove,
  getBalance,
} from './test-utils/getBalanceAndApprove'

const SWAP_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
const SLIPPAGE = new Percent(5, 100) // 5% or 10_000?
const RECIPIENT_ADDRESS = '0x548c321fCd078FB6906D6A65FDCabFEb7971D98F'

const checkQuoteToken = (
  before: CurrencyAmount<Currency>,
  after: CurrencyAmount<Currency>,
  tokensQuoted: CurrencyAmount<Currency>,
) => {
  // Check which is bigger to support exactIn and exactOut
  const tokensSwapped = after.greaterThan(before)
    ? after.subtract(before)
    : before.subtract(after)
  const tokensDiff = tokensQuoted.greaterThan(tokensSwapped)
    ? tokensQuoted.subtract(tokensSwapped)
    : tokensSwapped.subtract(tokensQuoted)
  const percentDiff = tokensDiff.asFraction.divide(tokensQuoted.asFraction)
  // expect(percentDiff.lessThan(SLIPPAGE)).to.be.equal(true)
  expect(Number(percentDiff.toSignificant(6))).to.be.lessThan(
    Number(SLIPPAGE.toSignificant(6)),
  )
}

const getQuoteToken = (
  tokenIn: Currency,
  tokenOut: Currency,
  tradeType: TradeType,
): Currency => {
  return tradeType == TradeType.EXACT_INPUT ? tokenOut : tokenIn
}

export function parseDeadline(deadline: number): number {
  return Math.floor(Date.now() / 1000) + deadline
}

const expandDecimals = (currency: Currency, amount: number): number => {
  return amount * 10 ** currency.decimals
}

describe('alpha router integration', async () => {
  let alphaRouter: AlphaRouter
  const multicall2Provider = new UniswapMulticallProvider(
    ChainId.MAINNET,
    ethers.provider,
  )

  const executeSwap = async (
    signer: any,
    methodParameters: MethodParameters,
    tokenIn: Currency,
    tokenOut: Currency,
    gasLimit?: BigNumber,
  ): Promise<{
    tokenInAfter: CurrencyAmount<Currency>
    tokenInBefore: CurrencyAmount<Currency>
    tokenOutAfter: CurrencyAmount<Currency>
    tokenOutBefore: CurrencyAmount<Currency>
  }> => {
    expect(tokenIn.symbol).to.be.not.equal(tokenOut.symbol)
    // We use this helper function for approving rather than hardhat.provider.approve
    // because there is custom logic built in for handling USDT and other checks
    const tokenInBefore = await getBalanceAndApprove(
      signer,
      SWAP_ROUTER_V2,
      tokenIn,
    )
    const tokenOutBefore = await getBalance(signer.address, tokenOut)

    const transaction = {
      data: methodParameters.calldata,
      to: SWAP_ROUTER_V2,
      value: BigNumber.from(methodParameters.value),
      from: signer.address,
      gasPrice: BigNumber.from(2000000000000),
      type: 1,
    }

    let transactionResponse: providers.TransactionResponse
    if (gasLimit) {
      transactionResponse = await signer.sendTransaction({
        ...transaction,
        gasLimit: gasLimit,
      })
    } else {
      transactionResponse = await signer.sendTransaction(transaction)
    }

    const receipt = await transactionResponse.wait()
    expect(receipt.status).to.be.equal(1) // Check for txn success

    const tokenInAfter = await getBalance(signer.address, tokenIn)
    const tokenOutAfter = await getBalance(signer.address, tokenOut)

    return {
      tokenInAfter,
      tokenInBefore,
      tokenOutAfter,
      tokenOutBefore,
    }
  }

  /**
   * Function to validate swapRoute data.
   * @param quote: CurrencyAmount<Currency>
   * @param quoteGasAdjusted: CurrencyAmount<Currency>
   * @param tradeType: TradeType
   * @param targetQuoteDecimalsAmount?: number - if defined, checks that the quoteDecimals is within the range of this +/- acceptableDifference (non inclusive bounds)
   * @param acceptableDifference?: number - see above
   */
  const validateSwapRoute = async (
    quote: CurrencyAmount<Currency>,
    quoteGasAdjusted: CurrencyAmount<Currency>,
    tradeType: TradeType,
    targetQuoteDecimalsAmount?: number,
    acceptableDifference?: number,
  ) => {
    // strict undefined checks here to avoid confusion with 0 being a falsy value
    if (targetQuoteDecimalsAmount !== undefined) {
      acceptableDifference =
        acceptableDifference !== undefined ? acceptableDifference : 0

      expect(Number(quote.toSignificant(6))).to.be.greaterThan(
        Number(
          CurrencyAmount.fromRawAmount(
            quote.currency,
            expandDecimals(
              quote.currency,
              targetQuoteDecimalsAmount - acceptableDifference,
            ),
          ).toSignificant(6),
        ),
      )
      expect(Number(quote.toSignificant(6))).to.be.lessThan(
        Number(
          CurrencyAmount.fromRawAmount(
            quote.currency,
            expandDecimals(
              quote.currency,
              targetQuoteDecimalsAmount + acceptableDifference,
            ),
          ).toSignificant(6),
        ),
      )
    }

    if (tradeType == TradeType.EXACT_INPUT) {
      // == lessThanOrEqualTo
      expect(!quoteGasAdjusted.greaterThan(quote)).to.be.equal(true)
    } else {
      // == greaterThanOrEqual
      expect(!quoteGasAdjusted.lessThan(quote)).to.be.equal(true)
    }
  }

  /**
   * Function to perform a call to executeSwap and validate the response
   * @param quote: CurrencyAmount<Currency>
   * @param tokenIn: Currency
   * @param tokenOut: Currency
   * @param methodParameters: MethodParameters
   * @param tradeType: TradeType
   * @param checkTokenInAmount?: number - if defined, check that the tokenInBefore - tokenInAfter = checkTokenInAmount
   * @param checkTokenOutAmount?: number - if defined, check that the tokenOutBefore - tokenOutAfter = checkTokenOutAmount
   */
  const validateExecuteSwap = async (
    signer: any,
    quote: CurrencyAmount<Currency>,
    tokenIn: Currency,
    tokenOut: Currency,
    methodParameters: MethodParameters | undefined,
    tradeType: TradeType,
    checkTokenInAmount?: number,
    checkTokenOutAmount?: number,
    estimatedGasUsed?: BigNumber,
  ) => {
    expect(methodParameters).not.to.be.undefined
    const {
      tokenInBefore,
      tokenInAfter,
      tokenOutBefore,
      tokenOutAfter,
    } = await executeSwap(
      signer,
      methodParameters!,
      tokenIn,
      tokenOut!,
      estimatedGasUsed,
    )
    if (tradeType == TradeType.EXACT_INPUT) {
      if (checkTokenInAmount) {
        console.log(tokenInAfter.toSignificant(6))
        console.log(tokenInBefore.toSignificant(6))
        expect(
          tokenInBefore
            .subtract(tokenInAfter)
            .equalTo(
              CurrencyAmount.fromRawAmount(
                tokenIn,
                expandDecimals(tokenIn, checkTokenInAmount),
              ),
            ),
        ).to.be.equal(true)
      }
      checkQuoteToken(
        tokenOutBefore,
        tokenOutAfter,
        /// @dev we need to recreate the CurrencyAmount object here because tokenOut can be different from quote.currency (in the case of ETH vs. WETH)
        CurrencyAmount.fromRawAmount(tokenOut, quote.quotient),
      )
    } else {
      if (checkTokenOutAmount) {
        console.log(tokenOutAfter.toSignificant(6))
        console.log(tokenOutBefore.toSignificant(6))
        expect(
          tokenOutAfter
            .subtract(tokenOutBefore)
            .equalTo(
              CurrencyAmount.fromRawAmount(
                tokenOut,
                expandDecimals(tokenOut, checkTokenOutAmount),
              ),
            ),
        ).to.be.equal(true)
      }
      checkQuoteToken(
        tokenInBefore,
        tokenInAfter,
        CurrencyAmount.fromRawAmount(tokenIn, quote.quotient),
      )
    }
  }

  before(async () => {
    const v3PoolProvider = new CachingV3PoolProvider(
      ChainId.MAINNET,
      new V3PoolProvider(ChainId.MAINNET, multicall2Provider),
      new NodeJSCache(new NodeCache({ stdTTL: 360, useClones: false })),
    )
    const v2PoolProvider = new V2PoolProvider(
      ChainId.MAINNET,
      multicall2Provider,
    )

    alphaRouter = new AlphaRouter({
      chainId: ChainId.MAINNET,
      provider: ethers.provider,
      // multicall2Provider,
      // v2PoolProvider,
      // v3PoolProvider,
    })
  })
  /**
   *  tests are 1:1 with routing api integ tests
   */
  for (const tradeType of [TradeType.EXACT_INPUT, TradeType.EXACT_OUTPUT]) {
    describe(`${ID_TO_NETWORK_NAME(1)} alpha - ${tradeType}`, () => {
      describe(`+ Execute on Hardhat Fork`, () => {
        it('erc20 -> erc20', async () => {
          const arthur = await ethers.getImpersonatedSigner(
            '0xf89d7b9c864f589bbF53a82105107622B35EaA40',
          )
          // declaring these to reduce confusion
          const tokenIn = USDC_MAINNET
          const tokenOut = USDT_MAINNET
          const amount =
            tradeType == TradeType.EXACT_INPUT
              ? parseAmount('100', tokenIn)
              : parseAmount('100', tokenOut)

          const swap = await alphaRouter.route(
            amount,
            getQuoteToken(tokenIn, tokenOut, tradeType),
            tradeType,
            {
              recipient: RECIPIENT_ADDRESS,
              slippageTolerance: SLIPPAGE,
              deadline: parseDeadline(360),
            },
          )

          expect(swap).to.not.be.undefined
          expect(swap).to.not.be.null

          const { quote, quoteGasAdjusted, methodParameters } = swap!

          await validateSwapRoute(quote, quoteGasAdjusted, tradeType, 100, 10)

          await validateExecuteSwap(
            arthur,
            quote,
            tokenIn,
            tokenOut,
            methodParameters,
            tradeType,
            100,
            100,
          )
        }).timeout(10000000)
      }).timeout(10000000)
    }).timeout(10000000)
  }
}).timeout(10000000)
