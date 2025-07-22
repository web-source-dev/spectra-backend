const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true
    },
    customerId: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    sku: {
        type: String,
        required: true
    },
    productDescription: {
        type: String,
        required: true
    },
    images: [{
        url: String,
        filename: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    claimType: {
        type: String,
        enum: ['damage', 'loss', 'theft', 'maintenance', 'other'],
        required: true
    },
    notes: String,
    adminNotes: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Pre-save middleware to update the updatedAt field
claimSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Claim = mongoose.model('Claim', claimSchema);

module.exports = Claim; 