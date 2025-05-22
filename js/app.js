/**
 * Main Application
 * Connects the UI with the blockchain, cryptography, and governance systems
 */

// Network state
let isSynced = false;
let syncStatus = "initializing";
const room = new WebsimSocket();

// Initialize the application
async function initializeApp() {
    try {
        // Initialize crypto system
        await cryptoManager.initialize();
        
        // Display identity info
        await updateIdentityInfo();
        
        // Initialize blockchain
        await blockchain.initialize();
        
        // Initialize governance system
        await governanceSystem.initialize();
        
        // Connect to the network
        await connectToNetwork();
        
        // Update UI
        updateUI();
        
        // Set up event listeners
        setupEventListeners();
        
        console.log("Application initialized successfully");
    } catch (error) {
        console.error("Initialization error:", error);
        updateSyncStatus("error", "Initialization failed");
    }
}

// Display identity information
async function updateIdentityInfo() {
    const identityId = await cryptoManager.getIdentityId();
    const publicKeyShort = cryptoManager.getAbbreviatedPublicKey();
    
    document.getElementById('identityInfo').innerHTML = `
        <p><strong>Identity ID:</strong> ${identityId}</p>
        <p><strong>Public Key:</strong> ${publicKeyShort}</p>
    `;
}

// Connect to the peer-to-peer network
async function connectToNetwork() {
    try {
        await room.initialize();
        
        // Subscribe to presence updates
        room.subscribePresence((presence) => {
            updatePeersList();
        });
        
        // Subscribe to room state updates
        room.subscribeRoomState((currentRoomState) => {
            if (currentRoomState.blockchain && currentRoomState.blockchain.length > 0) {
                handleBlockchainSync(currentRoomState.blockchain);
            }
            
            // Handle governance data sync
            if (currentRoomState.pendingProposals) {
                handlePendingProposalsSync(currentRoomState.pendingProposals);
            }
        });
        
        // Set up message handling
        room.onmessage = handleNetworkMessage;
        
        // Initialize our presence
        const myId = await cryptoManager.getIdentityId();
        room.updatePresence({
            identityId: myId,
            publicKey: cryptoManager.publicKeyString,
            connected: true
        });
        
        // Request blockchain and governance data from peers
        requestNetworkSync();
        
        updateSyncStatus("syncing", "Requesting network data");
        console.log("Connected to peer network");
    } catch (error) {
        console.error("Network connection error:", error);
        updateSyncStatus("error", "Network connection failed");
    }
}

// Request blockchain and governance data from peers
function requestNetworkSync() {
    room.send({
        type: "syncRequest",
        timestamp: Date.now(),
        echo: true
    });
}

// Handle incoming network messages
function handleNetworkMessage(event) {
    const data = event.data;
    
    switch (data.type) {
        case "syncRequest":
            // Someone wants our data - share our blockchain and proposals
            shareBlockchain();
            sharePendingProposals();
            break;
            
        case "newProposal":
            handleNewProposal(data);
            break;
            
        case "vote":
            handleVote(data);
            break;
            
        case "newBlock":
            handleNewBlock(data.block);
            break;
            
        case "blockchainRequest":
            shareBlockchain();
            break;
            
        case "connected":
            // When a new peer connects, share our data with them
            setTimeout(() => {
                shareBlockchain();
                sharePendingProposals();
            }, 1000); // Small delay to ensure they're ready to receive
            updatePeersList();
            break;
            
        case "disconnected":
            updatePeersList();
            break;
            
        default:
            console.log("Received unknown message type:", data.type);
    }
}

// Share our blockchain with peers
function shareBlockchain() {
    updateSyncStatus("syncing", "Sharing blockchain");
    
    // Update room state with our blockchain
    room.updateRoomState({
        blockchain: blockchain.chain
    });
}

// Share pending proposals that might not be in the blockchain yet
function sharePendingProposals() {
    updateSyncStatus("syncing", "Sharing pending proposals");
    
    // Get all pending proposals that aren't already in the blockchain
    const pendingProposals = {};
    for (const [id, proposal] of Object.entries(governanceSystem.proposals)) {
        if (proposal.status === 'pending') {
            pendingProposals[id] = proposal;
        }
    }
    
    // Share with peers
    room.updateRoomState({
        pendingProposals: pendingProposals
    });
}

// Handle blockchain sync from other peers
async function handleBlockchainSync(otherChain) {
    updateSyncStatus("syncing", "Receiving blockchain");
    
    // If the other chain is longer and valid, adopt it
    if (otherChain.length > blockchain.chain.length) {
        const merged = await blockchain.mergeChain(otherChain);
        if (merged) {
            // Re-initialize governance system with new chain data
            await governanceSystem.initialize();
            updateUI();
            updateSyncStatus("synced", "Blockchain synchronized");
        } else {
            updateSyncStatus("error", "Received invalid blockchain");
        }
    } else {
        updateSyncStatus("synced", "Blockchain up to date");
    }
}

// Handle pending proposals sync from other peers
function handlePendingProposalsSync(pendingProposals) {
    updateSyncStatus("syncing", "Receiving pending proposals");
    
    let newProposalsCount = 0;
    
    // Add any proposals we don't have
    for (const [id, proposal] of Object.entries(pendingProposals)) {
        if (!governanceSystem.proposals[id]) {
            governanceSystem.proposals[id] = proposal;
            newProposalsCount++;
        }
    }
    
    if (newProposalsCount > 0) {
        console.log(`Added ${newProposalsCount} new pending proposals from peers`);
        updateProposalsList();
    }
    
    updateSyncStatus("synced", "Proposals synchronized");
}

// Handle a new proposal from the network
function handleNewProposal(data) {
    if (!governanceSystem.proposals[data.proposal.id]) {
        governanceSystem.proposals[data.proposal.id] = data.proposal;
        updateProposalsList();
        
        // Also add to pending proposals in room state
        const pendingProposals = room.roomState.pendingProposals || {};
        pendingProposals[data.proposal.id] = data.proposal;
        room.updateRoomState({ pendingProposals });
    }
}

// Handle a vote from the network
function handleVote(data) {
    const { proposalId, vote, voter, timestamp } = data;
    
    if (governanceSystem.proposals[proposalId]) {
        const proposal = governanceSystem.proposals[proposalId];
        
        // Only count the most recent vote from each voter
        if (!proposal.votes.voters[voter] || 
            proposal.votes.voters[voter].timestamp < timestamp) {
            
            // Remove previous vote if exists
            if (proposal.votes.voters[voter]) {
                const previousVote = proposal.votes.voters[voter].vote;
                proposal.votes[previousVote]--;
            }
            
            // Add new vote
            proposal.votes[vote]++;
            proposal.votes.voters[voter] = {
                vote,
                timestamp
            };
            
            // Check if proposal should be executed
            governanceSystem.evaluateProposal(proposal);
            
            // If the proposal status changed, update the room state
            if (proposal.status !== 'pending') {
                const pendingProposals = {...room.roomState.pendingProposals} || {};
                if (pendingProposals[proposalId]) {
                    delete pendingProposals[proposalId];
                    room.updateRoomState({ pendingProposals });
                }
            }
            
            updateProposalsList();
        }
    }
}

// Handle a new block from the network
async function handleNewBlock(blockData) {
    updateSyncStatus("syncing", "Receiving new block");
    
    // Convert block data to Block object
    const block = new Block(
        blockData.index,
        blockData.timestamp,
        blockData.data,
        blockData.previousHash
    );
    block.hash = blockData.hash;
    block.nonce = blockData.nonce;
    block.signatures = blockData.signatures;
    
    // Add block to chain if valid
    const added = await blockchain.addBlock(block);
    if (added) {
        // Re-initialize governance system with new chain data
        await governanceSystem.initialize();
        
        // Remove proposals from pending proposals that are now in the blockchain
        const blockProposalIds = block.data
            .filter(tx => tx.type === 'proposal')
            .map(tx => tx.id);
        
        if (blockProposalIds.length > 0 && room.roomState.pendingProposals) {
            const pendingProposals = {...room.roomState.pendingProposals};
            let updated = false;
            
            for (const id of blockProposalIds) {
                if (pendingProposals[id]) {
                    delete pendingProposals[id];
                    updated = true;
                }
            }
            
            if (updated) {
                room.updateRoomState({ pendingProposals });
            }
        }
        
        updateUI();
    }
    
    updateSyncStatus("synced", "Block processed");
}

// Update the peers list
function updatePeersList() {
    const peersDiv = document.getElementById('peers');
    const peersList = Object.values(room.peers);
    
    if (peersList.length === 0) {
        peersDiv.innerHTML = '<p>No peers connected</p>';
        return;
    }
    
    let peersHtml = '';
    for (const peer of peersList) {
        const presence = room.presence[peer.id] || {};
        peersHtml += `
            <div class="peer">
                <img class="peer-avatar" src="${peer.avatarUrl}" alt="${peer.username}">
                <div>
                    <strong>${peer.username}</strong>
                    ${presence.identityId ? `<br><small>ID: ${presence.identityId.substring(0, 8)}...</small>` : ''}
                </div>
            </div>
        `;
    }
    
    peersDiv.innerHTML = peersHtml;
}

// Update the proposals list
function updateProposalsList() {
    const proposalsDiv = document.getElementById('proposalsList');
    const proposals = governanceSystem.getAllProposals();
    
    if (proposals.length === 0) {
        proposalsDiv.innerHTML = '<p>No proposals yet</p>';
        return;
    }
    
    let proposalsHtml = '';
    for (const proposal of proposals) {
        const yesVotes = proposal.votes.yes || 0;
        const noVotes = proposal.votes.no || 0;
        const totalVotes = yesVotes + noVotes;
        const yesPercentage = totalVotes > 0 ? Math.round((yesVotes / totalVotes) * 100) : 0;
        
        let statusTag = '';
        switch(proposal.status) {
            case 'pending':
                statusTag = '<span class="tag pending">Pending</span>';
                break;
            case 'approved':
                statusTag = '<span class="tag approved">Approved</span>';
                break;
            case 'rejected':
                statusTag = '<span class="tag rejected">Rejected</span>';
                break;
        }
        
        // Check if the current user has voted
        const myId = cryptoManager.getIdentityId ? cryptoManager.getIdentityId() : null;
        const hasVoted = myId && proposal.votes.voters && proposal.votes.voters[myId];
        const myVote = hasVoted ? proposal.votes.voters[myId].vote : null;
        
        proposalsHtml += `
            <div class="proposal">
                <div class="proposal-header">
                    <h3>${proposal.title}</h3>
                    ${statusTag}
                </div>
                <p>${proposal.description}</p>
                <p><small>Type: ${proposal.proposalType} | Created: ${new Date(proposal.timestamp).toLocaleString()}</small></p>
                <div class="votes-info">
                    <p>Votes: ${yesVotes} Yes (${yesPercentage}%) / ${noVotes} No (${100 - yesPercentage}%)</p>
                    ${hasVoted ? `<p><small>You voted: ${myVote}</small></p>` : ''}
                </div>
                ${proposal.status === 'pending' ? `
                    <div class="vote-buttons">
                        <button class="vote-yes" data-proposal-id="${proposal.id}" ${hasVoted && myVote === 'yes' ? 'disabled' : ''}>
                            ${hasVoted && myVote === 'yes' ? 'Voted Yes' : 'Vote Yes'}
                        </button>
                        <button class="vote-no" data-proposal-id="${proposal.id}" ${hasVoted && myVote === 'no' ? 'disabled' : ''}>
                            ${hasVoted && myVote === 'no' ? 'Voted No' : 'Vote No'}
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    proposalsDiv.innerHTML = proposalsHtml;
    
    // Add event listeners to vote buttons
    document.querySelectorAll('.vote-yes').forEach(button => {
        button.addEventListener('click', () => voteOnProposal(button.dataset.proposalId, true));
    });
    
    document.querySelectorAll('.vote-no').forEach(button => {
        button.addEventListener('click', () => voteOnProposal(button.dataset.proposalId, false));
    });
}

// Update the ledger view
function updateLedgerView() {
    const ledgerDiv = document.getElementById('ledgerView');
    
    if (blockchain.chain.length === 0) {
        ledgerDiv.innerHTML = '<p>No blocks in the ledger</p>';
        return;
    }
    
    // Display last 5 blocks for simplicity
    const displayChain = blockchain.chain.slice(-5).reverse();
    
    let ledgerHtml = '';
    for (const block of displayChain) {
        const txCount = block.data.length;
        const validators = Object.keys(block.signatures).length;
        
        ledgerHtml += `
            <div class="block">
                <p><strong>Block #${block.index}</strong> - ${new Date(block.timestamp).toLocaleString()}</p>
                <p>Transactions: ${txCount} | Validators: ${validators}</p>
                <p>Hash: ${block.hash.substring(0, 16)}...</p>
            </div>
        `;
    }
    
    ledgerDiv.innerHTML = ledgerHtml;
}

// Update the entire UI
function updateUI() {
    updateProposalsList();
    updateLedgerView();
    updatePeersList();
}

// Vote on a proposal
async function voteOnProposal(proposalId, vote) {
    try {
        updateSyncStatus("syncing", "Submitting vote");
        await governanceSystem.voteOnProposal(proposalId, vote);
        
        // Broadcast vote to the network
        const myId = await cryptoManager.getIdentityId();
        room.send({
            type: "vote",
            proposalId,
            vote: vote ? 'yes' : 'no',
            voter: myId,
            timestamp: Date.now()
        });
        
        updateProposalsList();
        updateSyncStatus("synced", "Vote submitted");
    } catch (error) {
        console.error("Error voting on proposal:", error);
        updateSyncStatus("error", "Vote failed");
    }
}

// Create a new proposal
async function createProposal(title, description, proposalType) {
    try {
        updateSyncStatus("syncing", "Creating proposal");
        const proposalId = await governanceSystem.createProposal(title, description, proposalType);
        
        // Add to pending proposals in room state
        const pendingProposals = room.roomState.pendingProposals || {};
        pendingProposals[proposalId] = governanceSystem.proposals[proposalId];
        room.updateRoomState({ pendingProposals });
        
        // Broadcast proposal to the network
        room.send({
            type: "newProposal",
            proposal: governanceSystem.proposals[proposalId]
        });
        
        updateProposalsList();
        updateSyncStatus("synced", "Proposal created");
        
        return true;
    } catch (error) {
        console.error("Error creating proposal:", error);
        updateSyncStatus("error", "Proposal creation failed");
        return false;
    }
}

// Update the sync status display
function updateSyncStatus(status, message) {
    syncStatus = status;
    isSynced = status === "synced";
    
    const statusEl = document.getElementById('syncStatus');
    statusEl.className = status;
    statusEl.textContent = message;
}

// Set up event listeners
function setupEventListeners() {
    // Proposal form submission
    document.getElementById('proposalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const title = document.getElementById('proposalTitle').value;
        const description = document.getElementById('proposalDescription').value;
        const proposalType = document.getElementById('proposalType').value;
        
        if (!title || !description || !proposalType) {
            alert("Please fill out all fields");
            return;
        }
        
        const success = await createProposal(title, description, proposalType);
        if (success) {
            // Clear form
            document.getElementById('proposalTitle').value = '';
            document.getElementById('proposalDescription').value = '';
            document.getElementById('proposalType').value = '';
        }
    });
}

// Start the application
document.addEventListener('DOMContentLoaded', initializeApp);