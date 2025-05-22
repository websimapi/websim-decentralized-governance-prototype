/**
 * Blockchain Module
 * Implements a simple blockchain for the decentralized governance system
 */

class Block {
    constructor(index, timestamp, data, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.data = data;
        this.previousHash = previousHash;
        this.hash = '';
        this.nonce = 0;
        this.signatures = {}; // Map of publicKey -> signature
    }

    /**
     * Calculate hash of the block
     */
    async calculateHash() {
        // Create a string representation of the block without the hash and signatures
        const blockData = {
            index: this.index,
            timestamp: this.timestamp,
            data: this.data,
            previousHash: this.previousHash,
            nonce: this.nonce
        };
        
        return await cryptoManager.hash(blockData);
    }

    /**
     * Simple proof of work
     */
    async mine(difficulty) {
        // Create a target string of zeros based on difficulty
        const target = Array(difficulty + 1).join('0');
        
        while (this.hash.substring(0, difficulty) !== target) {
            this.nonce++;
            this.hash = await this.calculateHash();
        }
        
        console.log(`Block mined: ${this.hash}`);
    }
    
    /**
     * Add a signature to the block
     */
    addSignature(publicKey, signature) {
        this.signatures[publicKey] = signature;
    }
    
    /**
     * Verify block signatures
     */
    async verifySignatures() {
        for (const [publicKey, signature] of Object.entries(this.signatures)) {
            // Create block data without hash and signatures for verification
            const blockData = {
                index: this.index,
                timestamp: this.timestamp,
                data: this.data,
                previousHash: this.previousHash,
                nonce: this.nonce
            };
            
            const isValid = await cryptoManager.verify(blockData, signature, publicKey);
            if (!isValid) {
                return false;
            }
        }
        return true;
    }
}

class Blockchain {
    constructor() {
        this.chain = [];
        this.pendingTransactions = [];
        this.difficulty = 2;
        this.validators = new Set(); // Set of validator public keys
        this.minValidations = 2; // Minimum number of validations required
    }

    /**
     * Initialize the blockchain
     */
    async initialize() {
        // Load chain from localStorage if available
        const savedChain = localStorage.getItem('blockchain');
        if (savedChain) {
            try {
                this.chain = JSON.parse(savedChain);
                console.log("Loaded blockchain from storage:", this.chain.length, "blocks");
                
                // Verify the integrity of the loaded chain
                if (!(await this.isChainValid())) {
                    console.error("Loaded chain is invalid, creating new blockchain");
                    this.chain = [];
                    await this.createGenesisBlock();
                }
            } catch (error) {
                console.error("Error loading blockchain:", error);
                await this.createGenesisBlock();
            }
        } else {
            await this.createGenesisBlock();
        }
        
        // Add current user as validator
        if (cryptoManager.publicKeyString) {
            this.validators.add(cryptoManager.publicKeyString);
        }
    }

    /**
     * Create the genesis block
     */
    async createGenesisBlock() {
        const genesisBlock = new Block(0, Date.now(), {
            type: "genesis",
            message: "Genesis Block",
            rules: []
        });
        
        genesisBlock.hash = await genesisBlock.calculateHash();
        
        // Sign the genesis block
        if (cryptoManager.keyPair) {
            const signature = await cryptoManager.sign({
                index: genesisBlock.index,
                timestamp: genesisBlock.timestamp,
                data: genesisBlock.data,
                previousHash: genesisBlock.previousHash,
                nonce: genesisBlock.nonce
            });
            
            genesisBlock.addSignature(cryptoManager.publicKeyString, signature);
        }
        
        this.chain = [genesisBlock];
        this.saveChain();
        
        console.log("Created genesis block");
    }

    /**
     * Get the latest block in the chain
     */
    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    /**
     * Add a transaction to pending transactions
     */
    async addTransaction(transaction) {
        // Add timestamp and sender info
        transaction.timestamp = Date.now();
        transaction.sender = await cryptoManager.getIdentityId();
        transaction.senderPublicKey = cryptoManager.publicKeyString;
        
        // Sign the transaction
        transaction.signature = await cryptoManager.sign(transaction);
        
        this.pendingTransactions.push(transaction);
        
        // Return transaction ID (hash of the transaction)
        return await cryptoManager.hash(transaction);
    }

    /**
     * Create a new block with pending transactions
     */
    async createBlock() {
        if (this.pendingTransactions.length === 0) {
            return null;
        }
        
        const previousBlock = this.getLatestBlock();
        const newBlock = new Block(
            previousBlock.index + 1,
            Date.now(),
            this.pendingTransactions,
            previousBlock.hash
        );
        
        // Calculate hash
        newBlock.hash = await newBlock.calculateHash();
        
        // Sign the block
        const blockData = {
            index: newBlock.index,
            timestamp: newBlock.timestamp,
            data: newBlock.data,
            previousHash: newBlock.previousHash,
            nonce: newBlock.nonce
        };
        
        const signature = await cryptoManager.sign(blockData);
        newBlock.addSignature(cryptoManager.publicKeyString, signature);
        
        return newBlock;
    }
    
    /**
     * Add a signature to a proposed block
     */
    async signBlock(block) {
        const blockData = {
            index: block.index,
            timestamp: block.timestamp,
            data: block.data,
            previousHash: block.previousHash,
            nonce: block.nonce
        };
        
        const signature = await cryptoManager.sign(blockData);
        block.addSignature(cryptoManager.publicKeyString, signature);
        
        return block;
    }
    
    /**
     * Verify a block and add it to the chain if valid
     */
    async addBlock(block) {
        // Check if block is valid
        if (block.index !== this.getLatestBlock().index + 1) {
            console.error("Invalid block index");
            return false;
        }
        
        if (block.previousHash !== this.getLatestBlock().hash) {
            console.error("Invalid previous hash");
            return false;
        }
        
        // Verify the hash
        const calculatedHash = await block.calculateHash();
        if (block.hash !== calculatedHash) {
            console.error("Invalid block hash");
            return false;
        }
        
        // Verify signatures
        if (!await block.verifySignatures()) {
            console.error("Invalid block signatures");
            return false;
        }
        
        // Check if we have enough validations
        const validatorCount = Object.keys(block.signatures).length;
        if (validatorCount < this.minValidations) {
            console.error(`Insufficient validations: ${validatorCount}/${this.minValidations}`);
            return false;
        }
        
        // Add block to chain
        this.chain.push(block);
        
        // Clear pending transactions that are now in the block
        const processedTxIds = block.data.map(tx => tx.id);
        this.pendingTransactions = this.pendingTransactions.filter(tx => 
            !processedTxIds.includes(tx.id)
        );
        
        // Save chain to localStorage
        this.saveChain();
        
        console.log("Block added to chain:", block);
        return true;
    }

    /**
     * Check if the chain is valid
     */
    async isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];
            
            // Verify block hash
            const calculatedHash = await currentBlock.calculateHash();
            if (currentBlock.hash !== calculatedHash) {
                console.error(`Block ${i} has invalid hash`);
                return false;
            }
            
            // Verify previous hash reference
            if (currentBlock.previousHash !== previousBlock.hash) {
                console.error(`Block ${i} has invalid previous hash reference`);
                return false;
            }
            
            // Verify signatures
            if (!await currentBlock.verifySignatures()) {
                console.error(`Block ${i} has invalid signatures`);
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Save chain to localStorage
     */
    saveChain() {
        localStorage.setItem('blockchain', JSON.stringify(this.chain));
    }
    
    /**
     * Merge with another chain
     */
    async mergeChain(otherChain) {
        // If the other chain is longer and valid, replace our chain
        if (otherChain.length > this.chain.length) {
            // Convert the received chain to Block objects
            const convertedChain = otherChain.map(blockData => {
                const block = new Block(
                    blockData.index,
                    blockData.timestamp,
                    blockData.data,
                    blockData.previousHash
                );
                block.hash = blockData.hash;
                block.nonce = blockData.nonce;
                block.signatures = blockData.signatures;
                return block;
            });
            
            // Set this chain temporarily and verify
            const originalChain = [...this.chain];
            this.chain = convertedChain;
            
            if (await this.isChainValid()) {
                console.log("Accepted new longer chain");
                this.saveChain();
                return true;
            } else {
                console.error("Received invalid chain");
                this.chain = originalChain;
                return false;
            }
        }
        
        return false;
    }
    
    /**
     * Get transactions of a specific type
     */
    getTransactionsByType(type) {
        const transactions = [];
        
        // Check all blocks (except genesis)
        for (let i = 1; i < this.chain.length; i++) {
            const blockTransactions = this.chain[i].data;
            transactions.push(...blockTransactions.filter(tx => tx.type === type));
        }
        
        // Also check pending transactions
        transactions.push(...this.pendingTransactions.filter(tx => tx.type === type));
        
        return transactions;
    }
}

// Export singleton
const blockchain = new Blockchain();

