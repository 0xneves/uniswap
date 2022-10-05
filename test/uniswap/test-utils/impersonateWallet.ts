import { expect } from 'chai'
import { ethers } from 'hardhat'

export const ImpersonateWallet = async (address: string) => {
  const signer = await ethers.getImpersonatedSigner(address)

  return signer
}