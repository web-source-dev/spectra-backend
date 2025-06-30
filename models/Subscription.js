const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
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
    plan: {
        type: String,
        enum: ['monthly', 'yearly'],
        required: true
    },
    stripeSubscriptionId: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['incomplete', 'incomplete_expired', 'active', 'past_due', 'canceled', 'unpaid'],
        default: 'incomplete'
    },
    currentPeriodEnd: {
        type: Date,
        required: true
    },
    lastPaymentDate: {
        type: Date
    },
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
subscriptionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription; 