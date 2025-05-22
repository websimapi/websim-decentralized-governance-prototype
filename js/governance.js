/**
 * Governance Module
 * Handles the governance logic for the decentralized system
 */

class GovernanceSystem {
    constructor() {
        this.proposals = {};
        this.rules = [];
        this.roles = {};
        this.resources = {};
        this.proposalVotes = {};
        this.PROPOSAL_THRESHOLD = 0.5; // 50% approval required
    }

    /**
     * Initialize the governance system
     */
    async initialize() {
        // Load existing rules and roles from the blockchain
        await this.loadGovernanceData();
        
        console.log("Governance system initialized");
    }

    /**
     * Load governance data from the blockchain
     */
    async loadGovernanceData() {
        // Get all governance-related transactions
        const proposals = blockchain.getTransactionsByType('proposal');
        const votes = blockchain.getTransactionsByType('vote');
        const executions = blockchain.getTransactionsByType('execution');
        
        // Process proposals
        for (const proposal of proposals) {
            this.proposals[proposal.id] = {
                id: proposal.id,
                title: proposal.title,
                description: proposal.description,
                proposalType: proposal.proposalType,
                creator: proposal.sender,
                timestamp: proposal.timestamp,
                status: 'pending',
                votes: { yes: 0, no: 0, voters: {} }
            };
        }
        
        // Process votes
        for (const vote of votes) {
            if (this.proposals[vote.proposalId]) {
                const proposal = this.proposals[vote.proposalId];
                
                // Only count the most recent vote from each voter
                if (!proposal.votes.voters[vote.sender] || 
                    proposal.votes.voters[vote.sender].timestamp < vote.timestamp) {
                    
                    // Remove previous vote if exists
                    if (proposal.votes.voters[vote.sender]) {
                        const previousVote = proposal.votes.voters[vote.sender].vote;
                        proposal.votes[previousVote]--;
                    }
                    
                    // Add new vote
                    proposal.votes[vote.vote]++;
                    proposal.votes.voters[vote.sender] = {
                        vote: vote.vote,
                        timestamp: vote.timestamp
                    };
                }
            }
        }
        
        // Process executions and update proposal statuses
        for (const execution of executions) {
            if (this.proposals[execution.proposalId]) {
                const proposal = this.proposals[execution.proposalId];
                proposal.status = execution.approved ? 'approved' : 'rejected';
                
                // If approved, apply the changes
                if (execution.approved) {
                    this.applyProposal(proposal);
                }
            }
        }
        
        // For all remaining pending proposals, check if they meet the threshold
        for (const proposalId in this.proposals) {
            const proposal = this.proposals[proposalId];
            if (proposal.status === 'pending') {
                this.evaluateProposal(proposal);
            }
        }
    }

    /**
     * Create a new proposal
     */
    async createProposal(title, description, proposalType) {
        const proposalData = {
            type: 'proposal',
            title,
            description,
            proposalType,
        };
        
        const proposalId = await blockchain.addTransaction(proposalData);
        
        // Add to local proposals cache
        this.proposals[proposalId] = {
            id: proposalId,
            title,
            description,
            proposalType,
            creator: await cryptoManager.getIdentityId(),
            timestamp: Date.now(),
            status: 'pending',
            votes: { yes: 0, no: 0, voters: {} }
        };
        
        return proposalId;
    }

    /**
     * Vote on a proposal
     */
    async voteOnProposal(proposalId, vote) {
        if (!this.proposals[proposalId]) {
            throw new Error("Proposal not found");
        }
        
        if (this.proposals[proposalId].status !== 'pending') {
            throw new Error("Voting is closed for this proposal");
        }
        
        const voteData = {
            type: 'vote',
            proposalId,
            vote: vote ? 'yes' : 'no',
        };
        
        await blockchain.addTransaction(voteData);
        
        // Update local vote count
        const proposal = this.proposals[proposalId];
        const voterId = await cryptoManager.getIdentityId();
        
        // If user already voted, remove their previous vote
        if (proposal.votes.voters[voterId]) {
            const previousVote = proposal.votes.voters[voterId].vote;
            proposal.votes[previousVote]--;
        }
        
        // Add new vote
        proposal.votes[vote ? 'yes' : 'no']++;
        proposal.votes.voters[voterId] = {
            vote: vote ? 'yes' : 'no',
            timestamp: Date.now()
        };
        
        // Check if proposal should be executed
        this.evaluateProposal(proposal);
        
        return true;
    }

    /**
     * Evaluate if a proposal should be executed
     */
    async evaluateProposal(proposal) {
        if (proposal.status !== 'pending') {
            return false;
        }
        
        const totalVotes = proposal.votes.yes + proposal.votes.no;
        if (totalVotes === 0) {
            return false;
        }
        
        const approvalRate = proposal.votes.yes / totalVotes;
        
        // If approval threshold is met
        if (approvalRate >= this.PROPOSAL_THRESHOLD) {
            await this.executeProposal(proposal.id, true);
            return true;
        } 
        // If rejection threshold is met (more than 50% no)
        else if (proposal.votes.no / totalVotes > 0.5) {
            await this.executeProposal(proposal.id, false);
            return true;
        }
        
        return false;
    }

    /**
     * Execute a proposal
     */
    async executeProposal(proposalId, approved) {
        if (!this.proposals[proposalId]) {
            throw new Error("Proposal not found");
        }
        
        const proposal = this.proposals[proposalId];
        
        const executionData = {
            type: 'execution',
            proposalId,
            approved,
            proposalType: proposal.proposalType
        };
        
        await blockchain.addTransaction(executionData);
        
        // Update proposal status
        proposal.status = approved ? 'approved' : 'rejected';
        
        // If approved, apply the changes
        if (approved) {
            this.applyProposal(proposal);
        }
        
        return true;
    }

    /**
     * Apply an approved proposal
     */
    applyProposal(proposal) {
        switch (proposal.proposalType) {
            case 'rule':
                this.rules.push({
                    id: proposal.id,
                    title: proposal.title,
                    description: proposal.description,
                    timestamp: proposal.timestamp
                });
                break;
                
            case 'resource':
                this.resources[proposal.id] = {
                    id: proposal.id,
                    title: proposal.title,
                    description: proposal.description,
                    timestamp: proposal.timestamp
                };
                break;
                
            case 'role':
                this.roles[proposal.id] = {
                    id: proposal.id,
                    title: proposal.title,
                    description: proposal.description,
                    timestamp: proposal.timestamp
                };
                break;
        }
    }

    /**
     * Get all proposals
     */
    getAllProposals() {
        return Object.values(this.proposals).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Get current rules
     */
    getCurrentRules() {
        return this.rules;
    }

    /**
     * Get current resources
     */
    getCurrentResources() {
        return Object.values(this.resources);
    }

    /**
     * Get current roles
     */
    getCurrentRoles() {
        return Object.values(this.roles);
    }
}

// Export singleton
const governanceSystem = new GovernanceSystem();

