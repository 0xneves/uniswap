import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { constants } from 'ethers'
import { abi } from '../../../src/abi/erc20-abi'
import { ethers } from 'hardhat'

export const getBalance = async (
  address: string,
  currency: Currency,
): Promise<CurrencyAmount<Currency>> => {
  if (!currency.isToken) {
    return CurrencyAmount.fromRawAmount(
      currency,
      (await ethers.provider.getBalance(address)).toString(),
    )
  }

  const tokenIn = new ethers.Contract(currency.address, abi, ethers.provider)

  return CurrencyAmount.fromRawAmount(
    currency,
    (await tokenIn.balanceOf(address)).toString(),
  )
}

export const getBalanceAndApprove = async (
  signer: any,
  approveTarget: string,
  currency: Currency,
): Promise<CurrencyAmount<Currency>> => {
  if (currency.isToken) {
    const contract = new ethers.Contract(currency.address, abi, ethers.provider)
    if (currency.symbol == 'USDT') {
      await (await contract.connect(signer).approve(approveTarget, 0)).wait()
    }
    await (
      await contract
        .connect(signer)
        .approve(approveTarget, constants.MaxUint256)
    ).wait()
  }

  return getBalance(signer.address, currency)
}
