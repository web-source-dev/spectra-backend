const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    sku: {
        type: String,
        required: true
    },
    otp: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 600 // OTP expires after 10 minutes (600 seconds)
    }
});

// Create a compound index on email and sku
otpVerificationSchema.index({ email: 1, sku: 1 });

const OtpVerification = mongoose.model('OtpVerification', otpVerificationSchema);

module.exports = OtpVerification; 