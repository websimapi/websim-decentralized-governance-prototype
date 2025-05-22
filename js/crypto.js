/**
 * Crypto Module
 * Handles cryptographic operations for the decentralized governance system
 */

class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.publicKeyString = null;
    }

    /**
     * Initialize cryptographic identity
     */
    async initialize() {
        // Check if we have keys in localStorage
        const savedPrivateKey = localStorage.getItem('privateKey');
        const savedPublicKey = localStorage.getItem('publicKey');
        
        if (savedPrivateKey && savedPublicKey) {
            try {
                // Import existing keys
                const privateKey = await this.importPrivateKey(savedPrivateKey);
                const publicKey = await this.importPublicKey(savedPublicKey);
                
                this.keyPair = { privateKey, publicKey };
                this.publicKeyString = savedPublicKey;
                
                console.log("Loaded existing cryptographic identity");
                return true;
            } catch (error) {
                console.error("Error loading saved keys:", error);
                // If there's an error, generate new keys
            }
        }
        
        // Generate new key pair
        try {
            const keyPair = await window.crypto.subtle.generateKey(
                {
                    name: "ECDSA",
                    namedCurve: "P-256"
                },
                true,
                ["sign", "verify"]
            );
            
            this.keyPair = keyPair;
            
            // Export public key for storage and sharing
            const exportedPublicKey = await window.crypto.subtle.exportKey(
                "spki",
                keyPair.publicKey
            );
            
            // Export private key for storage
            const exportedPrivateKey = await window.crypto.subtle.exportKey(
                "pkcs8",
                keyPair.privateKey
            );
            
            // Convert to base64 strings for storage
            const publicKeyString = this.arrayBufferToBase64(exportedPublicKey);
            const privateKeyString = this.arrayBufferToBase64(exportedPrivateKey);
            
            // Save to localStorage
            localStorage.setItem('publicKey', publicKeyString);
            localStorage.setItem('privateKey', privateKeyString);
            
            this.publicKeyString = publicKeyString;
            
            console.log("Generated new cryptographic identity");
            return true;
        } catch (error) {
            console.error("Error generating keys:", error);
            return false;
        }
    }
    
    /**
     * Import a private key from base64 string
     */
    async importPrivateKey(base64Key) {
        const binaryKey = this.base64ToArrayBuffer(base64Key);
        return window.crypto.subtle.importKey(
            "pkcs8",
            binaryKey,
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            true,
            ["sign"]
        );
    }
    
    /**
     * Import a public key from base64 string
     */
    async importPublicKey(base64Key) {
        const binaryKey = this.base64ToArrayBuffer(base64Key);
        return window.crypto.subtle.importKey(
            "spki",
            binaryKey,
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            true,
            ["verify"]
        );
    }
    
    /**
     * Sign data with the private key
     */
    async sign(data) {
        if (!this.keyPair) {
            throw new Error("Cryptographic identity not initialized");
        }
        
        // Convert data to JSON if it's an object
        const dataString = typeof data === 'object' ? JSON.stringify(data) : data;
        
        // Convert to ArrayBuffer
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataString);
        
        // Sign the data
        const signature = await window.crypto.subtle.sign(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" }
            },
            this.keyPair.privateKey,
            dataBuffer
        );
        
        // Convert signature to base64 for transmission
        return this.arrayBufferToBase64(signature);
    }
    
    /**
     * Verify a signature against public key
     */
    async verify(data, signature, publicKeyString) {
        // Convert signature from base64
        const binarySignature = this.base64ToArrayBuffer(signature);
        
        // Convert data to JSON if it's an object
        const dataString = typeof data === 'object' ? JSON.stringify(data) : data;
        
        // Convert to ArrayBuffer
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataString);
        
        // Import the public key
        const publicKey = await this.importPublicKey(publicKeyString);
        
        // Verify the signature
        return window.crypto.subtle.verify(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" }
            },
            publicKey,
            binarySignature,
            dataBuffer
        );
    }
    
    /**
     * Generate a hash of data
     */
    async hash(data) {
        // Convert data to JSON if it's an object
        const dataString = typeof data === 'object' ? JSON.stringify(data) : data;
        
        // Convert to ArrayBuffer
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(dataString);
        
        // Hash the data
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        
        // Convert to hex string
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    /**
     * Convert ArrayBuffer to Base64 string
     */
    arrayBufferToBase64(buffer) {
        const binary = String.fromCharCode.apply(null, new Uint8Array(buffer));
        return window.btoa(binary);
    }
    
    /**
     * Convert Base64 string to ArrayBuffer
     */
    base64ToArrayBuffer(base64) {
        const binary = window.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    /**
     * Generate a deterministic ID from public key
     */
    async getIdentityId() {
        if (!this.publicKeyString) {
            throw new Error("Public key not available");
        }
        
        const hash = await this.hash(this.publicKeyString);
        return hash.substring(0, 16); // Use first 16 chars of hash as ID
    }
    
    /**
     * Get abbreviated public key for display
     */
    getAbbreviatedPublicKey() {
        if (!this.publicKeyString) return "Unknown";
        return `${this.publicKeyString.substring(0, 8)}...${this.publicKeyString.substring(this.publicKeyString.length - 8)}`;
    }
}

// Export singleton
const cryptoManager = new CryptoManager();

