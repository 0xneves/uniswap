import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-chai-matchers'
import dotenv from 'dotenv'

dotenv.config()

const { ETH, ETHERSCAN, ETH_ACC_1 } = process.env

const config: HardhatUserConfig = {
  solidity: '0.8.0',
  gasReporter: {
    enabled: true,
  },
  networks: {
    hardhat: {
      forking: {
        url: `${ETH}`,
        blockNumber: 15677043,
      },
    },
    ethereum: { 
      url: `${ETH}`,
      accounts: [`${ETH_ACC_1}`],
    }
  },
  etherscan: {
    apiKey: `${ETHERSCAN}`,
  },
}

export default config
