const express = require("express"),
    puppeteer = require("puppeteer"),
    axios = require("axios"),
    path = require("path"),
    http = require("http"),
    { Server } = require("socket.io"),
    app = express(),
    server = http.createServer(app),
    io = new Server(server, {
        cors: {
            origin: ["http://localhost:3000", "http://localhost:3001","https://spectra-tawny.vercel.app","https://spectra-metal-claim.vercel.app","https://spectra-metal-claim-udbf.vercel.app"],
            methods: ["GET", "POST"],
            credentials: true
        }
    }),
    PORT = process.env.PORT || 8e3;
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Import the email service at the top of the file
const { sendSubscriptionConfirmation, sendOtpVerification } = require('./services/emailService');

// Import models instead of defining schema in server.js
const Submission = require('./models/Submission');
const Order = require('./models/Order');
const Subscription = require('./models/Subscription');
const OtpVerification = require('./models/OtpVerification');
const Claim = require('./models/Claim');

// Import routes
const orderRoutes = require('./routes/orders');

// Connect to MongoDB Atlas
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/spectra';
console.log('Connecting to MongoDB with URI:', mongoUri);

mongoose.connect(mongoUri)
    .then(async () => {
        console.log('Connected to MongoDB successfully');
        
        // Verify connection by checking if we can access the collections
        try {
            const db = mongoose.connection.db;
            const collections = await db.listCollections().toArray();
            console.log('Available collections:', collections.map(c => c.name));
            
            // Test query to verify data access
            const submissionCount = await Submission.countDocuments();
            const orderCount = await Order.countDocuments();
            const subscriptionCount = await Subscription.countDocuments();
            
            console.log(`Database verification - Submissions: ${submissionCount}, Orders: ${orderCount}, Subscriptions: ${subscriptionCount}`);
        } catch (error) {
            console.error('Error verifying database connection:', error);
        }
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcvqytwuq',
    api_key: process.env.CLOUDINARY_API_KEY || '573695395824533',
    api_secret: process.env.CLOUDINARY_API_SECRET || '2CqOsEyaZZGBvVclLGNYuwHrhQs'
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'metal_transactions',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'webp', 'avif', 'heic', 'heif'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }]
    }
});

const upload = multer({ storage: storage });

// Configure server and middleware
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
}).on("error", err => {
    "EADDRINUSE" === err.code ?
        console.error(`Port ${PORT} is already in use. Please try a different port.`) :
        console.error("Error starting server:", err),
        process.exit(1)
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:3001',"https://spectra-tawny.vercel.app","https://spectra-metal-claim.vercel.app","https://spectra-metal-claim-udbf.vercel.app"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));

// Handle preflight requests for Socket.IO
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "ALLOWALL");
    next();
});

// Set up session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000, // 1 hour by default
        sameSite: 'lax',
        path: '/',
        httpOnly: true
    }
}));

// Use order routes
app.use('/orders', orderRoutes);

// Helper function to generate OTP
function generateOTP(length = 6) {
    const digits = '0123456789';
    let OTP = '';
    for (let i = 0; i < length; i++) {
        OTP += digits[Math.floor(Math.random() * 10)];
    }
    return OTP;
}

// API endpoint to send OTP for SKU data access
app.post('/api/send-otp', async (req, res) => {
    try {
        const { email, sku } = req.body;

        if (!email || !sku) {
            return res.status(400).json({
                success: false,
                message: 'Email and SKU are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Check if the SKU exists
        const submission = await Submission.findOne({
            sku: sku
        }).sort({ timestamp: -1 });

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'SKU not found'
            });
        }

        // Generate a 6-digit OTP
        const otp = generateOTP(6);

        // Remove any existing OTP for this email/SKU combination
        await OtpVerification.deleteMany({ email, sku });

        // Save the new OTP
        const newOtp = new OtpVerification({
            email,
            sku,
            otp
        });

        await newOtp.save();

        // Send OTP email
        const emailResult = await sendOtpVerification(email, otp, sku);

        if (!emailResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to send OTP email. Please try again.'
            });
        }

        // Return success response
        res.json({
            success: true,
            message: 'Verification code sent to your email'
        });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing your request. Please try again.'
        });
    }
});

// API endpoint to verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, sku, otp } = req.body;

        if (!email || !sku || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email, SKU, and OTP are required'
            });
        }

        // Find the OTP record
        const otpRecord = await OtpVerification.findOne({ email, sku });

        if (!otpRecord) {
            return res.status(400).json({
                success: false,
                message: 'Verification code expired or not found. Please request a new code.'
            });
        }

        // Check if OTP matches
        if (otpRecord.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: 'Invalid verification code. Please try again.'
            });
        }

        // OTP is valid - Find the submission data
        const submission = await Submission.findOne({
            sku: sku
        }).sort({ timestamp: -1 });

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'SKU data not found'
            });
        }

        // Store verification in session
        req.session.verifiedSku = {
            email,
            sku,
            timestamp: Date.now()
        };

        // Delete the OTP after successful verification
        await OtpVerification.deleteOne({ _id: otpRecord._id });

        // Return the submission data
        res.json({
            success: true,
            message: 'Email verified successfully',
            submission: {
                name: submission.name,
                email: submission.email,
                sku: submission.sku,
                description: submission.description,
                metal: submission.metal,
                grams: submission.grams,
                imagePath: submission.imagePath
            }
        });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing your request. Please try again.'
        });
    }
});

// Modified API endpoint for SKU data retrieval with email verification
app.get('/api/sku-data', async (req, res) => {
    try {
        const sku = req.query.sku;

        if (!sku) {
            return res.json({ success: false, message: 'No SKU provided' });
        }

        // Check if this SKU is already verified in the session
        const isVerified = req.session.verifiedSku &&
            req.session.verifiedSku.sku === sku &&
            (Date.now() - req.session.verifiedSku.timestamp < 30 * 60 * 1000); // 30 minutes

        if (isVerified) {
            // Skip verification if already verified recently
            const submission = await Submission.findOne({
                sku: { $regex: new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            }).sort({ timestamp: -1 });

            if (!submission) {
                return res.json({ success: false, message: 'SKU not found' });
            }

            return res.json({
                success: true,
                verified: true,
                submission: {
                    name: submission.name,
                    email: submission.email,
                    sku: submission.sku,
                    description: submission.description,
                    metal: submission.metal,
                    grams: submission.grams,
                    imagePath: submission.imagePath
                }
            });
        }

        // If not verified, just check if the SKU exists
        const submission = await Submission.findOne({
            sku: { $regex: new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        }).sort({ timestamp: -1 });

        if (!submission) {
            return res.json({ success: false, message: 'SKU not found' });
        }

        // Return email associated with the SKU but require verification
        return res.json({
            success: true,
            verified: false,
            requiresVerification: true,
            email: submission.email,
            message: 'Email verification required to access SKU data'
        });

    } catch (error) {
        console.error('Error fetching SKU data:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching SKU data',
            error: error.message
        });
    }
});

// Get metal prices - exported for use in other routes
async function getMetalPrices() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            ignoreDefaultArgs: ["--disable-extensions"]
        });
        const page = await browser.newPage();
        await page.goto("https://www.metalsdaily.com/live-prices/pgms/", { timeout: 6e4 });
        const prices = await page.evaluate(() => {
            const result = {};
            document.querySelectorAll("table tr").forEach(row => {
                const cells = row.querySelectorAll("td");
                if (cells.length > 2) {
                    let metal = cells[0].innerText.trim(),
                        price = cells[2].innerText.trim().replace(/,/g, "");
                    if (metal.includes("USD/OZ")) {
                        metal = metal.replace("USD/OZ", "").trim();
                        result[metal] = parseFloat(price) / 28;
                    }
                }
            });
            return result;
        });
        
        // Validate that we got some prices
        if (prices && Object.values(prices).some(price => price > 0)) {
            return prices;
        } else {
            throw new Error("No valid prices scraped");
        }
    } catch (error) {
        console.error("Error scraping metal prices:", error.message);
        // Fallback to Yahoo Finance API data
        try {
            console.log("Using fallback method for metal prices...");
            const goldData = await getMetalData("GC=F");
            const silverData = await getMetalData("SI=F");
            const platinumData = await getMetalData("PL=F");
            const palladiumData = await getMetalData("PA=F");

            const fallbackPrices = {
                Gold: goldData.prices.length > 0 ? goldData.prices.slice(-1)[0] / 28 : 2000,
                Silver: silverData.prices.length > 0 ? silverData.prices.slice(-1)[0] / 28 : 25,
                Platinum: platinumData.prices.length > 0 ? platinumData.prices.slice(-1)[0] / 28 : 950,
                Palladium: palladiumData.prices.length > 0 ? palladiumData.prices.slice(-1)[0] / 28 : 1000
            };

            // Ensure we have valid fallback prices
            if (Object.values(fallbackPrices).some(price => price > 0)) {
                return fallbackPrices;
            } else {
                throw new Error("Fallback prices also failed");
            }
        } catch (fallbackError) {
            console.error("Fallback method also failed:", fallbackError.message);
            // Return reasonable default prices instead of zeros
            return { 
                Gold: 2000, 
                Silver: 25, 
                Platinum: 950, 
                Palladium: 1000 
            };
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Claim policy routes
app.get('/claim-policy/:email/:sku', async (req, res) => {
    try {
        const { email, sku } = req.params;

        // Find submission by SKU
        const submission = await Submission.findOne({ sku: sku });

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Product not found with the provided SKU',
                error: { status: 404, stack: '' }
            });
        }

        // Calculate price based on metal value
        let metalPrices;
        try {
            metalPrices = await getMetalPrices();
        } catch (error) {
            console.error('Error getting metal prices, using fallback values:', error);
            // Fallback to default prices if API fails
            metalPrices = {
                Gold: 2000,
                Silver: 25,
                Platinum: 950,
                Palladium: 1000
            };
        }

        // Validate submission data
        if (!submission.metal) {
            console.warn('Missing metal type in submission, defaulting to Gold');
            submission.metal = 'Gold';
        }

        if (!submission.grams || isNaN(submission.grams)) {
            console.warn('Invalid grams value in submission, defaulting to 1g');
            submission.grams = 1;
        }

        // Calculate prices
        const metalPrice = metalPrices[submission.metal] || 0;
        const metalValue = submission.grams * metalPrice;
        const monthlyPrice = Math.max(9.99, (metalValue * 0.02).toFixed(2));
        const yearlyPrice = Math.max(99.99, (metalValue * 0.18).toFixed(2)); // 10% discount for yearly

        // Check if a subscription already exists for this email and SKU
        const existingSubscription = await Subscription.findOne({
            email: email,
            sku: sku,
            status: { $in: ['active', 'trialing', 'incomplete'] } // Only consider active-like subscriptions
        });

        // If subscription exists, get more details from Stripe
        let stripeSubscription = null;
        if (existingSubscription) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                stripeSubscription = await stripe.subscriptions.retrieve(existingSubscription.stripeSubscriptionId);

                // Update our database with latest info from Stripe
                existingSubscription.status = stripeSubscription.status;
                existingSubscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
                await existingSubscription.save();

                console.log('Found existing subscription:', existingSubscription.stripeSubscriptionId);
            } catch (error) {
                console.error('Error retrieving subscription from Stripe:', error);
                // Continue with our database record if Stripe API fails
            }
        }

        // Return JSON instead of rendering EJS template
        res.json({
            success: true,
            email,
            sku,
            submission: {
                name: submission.name,
                email: submission.email,
                sku: submission.sku,
                description: submission.description,
                metal: submission.metal,
                grams: submission.grams,
                calculatedPrice: submission.calculatedPrice,
                imagePath: submission.imagePath
            },
            monthlyPrice: parseFloat(monthlyPrice),
            yearlyPrice: parseFloat(yearlyPrice),
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
            existingSubscription: existingSubscription ? {
                _id: existingSubscription._id,
                customerId: existingSubscription.customerId,
                email: existingSubscription.email,
                sku: existingSubscription.sku,
                plan: existingSubscription.plan,
                stripeSubscriptionId: existingSubscription.stripeSubscriptionId,
                status: existingSubscription.status,
                currentPeriodEnd: existingSubscription.currentPeriodEnd,
                lastPaymentDate: existingSubscription.lastPaymentDate,
                createdAt: existingSubscription.createdAt,
                updatedAt: existingSubscription.updatedAt
            } : null
        });
    } catch (error) {
        console.error('Error loading claim policy page:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading claim policy page',
            error: {
                status: 500,
                stack: process.env.NODE_ENV === 'development' ? error.stack : '',
                message: error.message
            }
        });
    }
});

// Create subscription endpoint
app.post('/create-subscription', async (req, res) => {
    try {
        const { email, sku, plan } = req.body;

        if (!email || !sku || !plan) {
            return res.status(400).json({
                error: {
                    message: 'Missing required parameters: email, sku, and plan are required'
                }
            });
        }

        // Find submission by SKU
        const submission = await Submission.findOne({ sku: sku });

        if (!submission) {
            return res.status(404).json({
                error: {
                    message: 'Product not found with the provided SKU'
                }
            });
        }

        // Get current metal prices for calculation
        let metalPrices;
        try {
            metalPrices = await getMetalPrices();
        } catch (error) {
            console.error('Error getting metal prices, using fallback values:', error);
            // Fallback to default prices if API fails
            metalPrices = {
                Gold: 2000,
                Silver: 25,
                Platinum: 950,
                Palladium: 1000
            };
        }

        // Validate submission data
        if (!submission.metal) {
            console.warn('Missing metal type in submission, defaulting to Gold');
            submission.metal = 'Gold';
        }

        if (!submission.grams || isNaN(submission.grams)) {
            console.warn('Invalid grams value in submission, defaulting to 1g');
            submission.grams = 1;
        }

        // Calculate price based on metal value
        const metalPrice = metalPrices[submission.metal] || 0;
        console.log(`Using price for ${submission.metal}: $${metalPrice} per oz`);

        const metalValue = submission.grams * metalPrice;
        console.log(`Metal value: ${submission.grams}g * $${metalPrice}/oz = $${metalValue}`);

        const monthlyPrice = Math.max(9.99, (metalValue * 0.02).toFixed(2));
        const yearlyPrice = Math.max(99.99, (metalValue * 0.18).toFixed(2)); // 10% discount for yearly

        // Initialize Stripe
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        console.log('Creating subscription for:', email, sku, plan);
        console.log('Calculated prices - Monthly:', monthlyPrice, 'Yearly:', yearlyPrice);

        // Create or get customer
        let customer;
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
        } else {
            customer = await stripe.customers.create({
                email: email,
                metadata: {
                    sku: sku
                }
            });
        }

        // Create a price first since we're using dynamic pricing
        const price = await stripe.prices.create({
            unit_amount: Math.round(parseFloat(plan === 'monthly' ? monthlyPrice : yearlyPrice) * 100),
            currency: 'usd',
            recurring: {
                interval: plan === 'monthly' ? 'month' : 'year',
            },
            product_data: {
                name: `Metal Protection Plan - ${plan === 'monthly' ? 'Monthly' : 'Annual'} - SKU: ${sku}`,
                metadata: {
                    sku: sku
                }
            },
            metadata: {
                sku: sku
            }
        });

        console.log('Creating subscription with price ID:', price.id);

        // Create subscription with the dynamic price
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [
                { price: price.id }
            ],
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent'],
            metadata: {
                sku: sku,
                plan: plan,
                email: email
            }
        });

        // Add the subscription ID to the payment intent metadata for easier lookup
        if (subscription.latest_invoice && subscription.latest_invoice.payment_intent) {
            await stripe.paymentIntents.update(
                subscription.latest_invoice.payment_intent.id,
                {
                    metadata: {
                        subscription: subscription.id,
                        sku: sku,
                        plan: plan,
                        email: email
                    }
                }
            );
            console.log('Updated payment intent metadata with subscription ID');
        }

        // Validate that we have a payment intent with client secret
        if (!subscription.latest_invoice || !subscription.latest_invoice.payment_intent) {
            console.error('Missing payment intent in subscription:', subscription);
            throw new Error('Subscription created but missing payment intent');
        }

        console.log('Subscription created:', subscription.id);

        if (!subscription.latest_invoice || !subscription.latest_invoice.payment_intent) {
            console.error('Missing payment intent in subscription:', subscription);
            throw new Error('Missing payment intent in subscription response');
        }

        console.log('Payment intent:', subscription.latest_invoice.payment_intent.id);
        console.log('Client secret:', subscription.latest_invoice.payment_intent.client_secret);

        // Log full subscription details for debugging
        console.log('Full subscription details:', JSON.stringify(subscription, null, 2));

        // Save subscription info to database
        const newSubscription = new Subscription({
            customerId: customer.id,
            email: email,
            sku: sku,
            plan: plan,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000)
        });

        await newSubscription.save();
        console.log('Subscription saved to database');

        res.json({
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice.payment_intent.client_secret
        });
    } catch (error) {
        console.error('Error creating subscription:', error);

        // Log detailed error information
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code
        });

        // Check for specific Stripe errors
        if (error.type && error.type.startsWith('Stripe')) {
            console.error('Stripe error type:', error.type);
            console.error('Stripe error code:', error.code);
            console.error('Stripe error message:', error.message);

            return res.status(400).json({
                error: {
                    message: `Stripe error: ${error.message}`,
                    type: error.type,
                    code: error.code
                }
            });
        }

        res.status(500).json({
            error: {
                message: error.message || 'An error occurred while creating the subscription'
            }
        });
    }
});

// Webhook for Stripe events - use raw body parser for Stripe signatures
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'invoice.paid':
            const invoice = event.data.object;
            // Update subscription status
            await Subscription.findOneAndUpdate(
                { stripeSubscriptionId: invoice.subscription },
                {
                    status: 'active',
                    lastPaymentDate: new Date()
                }
            );
            break;
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
            const subscription = event.data.object;
            await Subscription.findOneAndUpdate(
                { stripeSubscriptionId: subscription.id },
                {
                    status: subscription.status,
                    currentPeriodEnd: new Date(subscription.current_period_end * 1000)
                }
            );
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Subscription success page
app.get('/subscription-success', async (req, res) => {
    try {
        const { payment_intent, subscription, payment_intent_client_secret } = req.query;

        console.log('Subscription success page accessed with params:', req.query);

        // Initialize Stripe
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        // Try to get subscription ID from multiple sources
        let subscriptionId = subscription;

        // Validate that the subscription ID starts with 'sub_'
        if (subscriptionId && !subscriptionId.startsWith('sub_')) {
            console.log('Invalid subscription ID format, clearing:', subscriptionId);
            subscriptionId = null;
        }

        // If no subscription ID directly, try to extract from payment_intent_client_secret
        if (!subscriptionId && payment_intent_client_secret) {
            // Don't use the client secret directly as it might be a payment intent ID
            console.log('Have payment_intent_client_secret, but not using for direct subscription lookup');
        }

        // If we have a payment intent, try to find the subscription through it
        if (!subscriptionId && payment_intent) {
            try {
                console.log('Looking up subscription via payment intent:', payment_intent);

                // Get payment intent details
                const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
                console.log('Found payment intent:', paymentIntent.id);

                // Check if payment intent has metadata with subscription ID
                if (paymentIntent.metadata && paymentIntent.metadata.subscription) {
                    // Validate that it looks like a subscription ID
                    if (paymentIntent.metadata.subscription.startsWith('sub_')) {
                        subscriptionId = paymentIntent.metadata.subscription;
                        console.log('Found subscription ID in payment intent metadata:', subscriptionId);
                    } else {
                        console.log('Invalid subscription ID format in metadata:', paymentIntent.metadata.subscription);
                    }
                }

                // If still no subscription, try to find via invoice
                if (!subscriptionId && paymentIntent.invoice) {
                    console.log('Looking up invoice:', paymentIntent.invoice);
                    const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);

                    if (invoice.subscription) {
                        if (typeof invoice.subscription === 'string' && invoice.subscription.startsWith('sub_')) {
                            subscriptionId = invoice.subscription;
                            console.log('Found subscription ID from invoice:', subscriptionId);
                        } else {
                            console.log('Invalid subscription format from invoice:', invoice.subscription);
                        }
                    } else {
                        console.log('Invoice does not contain subscription ID:', invoice.id);
                    }
                }
            } catch (lookupError) {
                console.error('Error looking up payment intent:', lookupError);
            }
        }

        // If we still don't have a subscription ID, try to find the most recent one for this customer
        if (!subscriptionId) {
            try {
                // If we have a payment intent client secret, try to get the payment intent
                if (payment_intent_client_secret) {
                    const piId = payment_intent_client_secret.split('_secret')[0];
                    if (piId && piId.startsWith('pi_')) {
                        console.log('Trying to get payment intent from client secret:', piId);
                        const paymentIntent = await stripe.paymentIntents.retrieve(piId);

                        // Check customer ID
                        if (paymentIntent.customer) {
                            console.log('Found customer ID from payment intent:', paymentIntent.customer);

                            // Look up subscriptions for this customer
                            const subscriptions = await stripe.subscriptions.list({
                                customer: paymentIntent.customer,
                                limit: 1,
                                status: 'all'
                            });

                            if (subscriptions.data.length > 0) {
                                subscriptionId = subscriptions.data[0].id;
                                console.log('Found subscription for customer:', subscriptionId);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error looking up subscription from client secret:', error);
            }
        }

        // Last resort: look up most recent subscription in our database
        if (!subscriptionId) {
            const recentSubscription = await Subscription.findOne().sort({ createdAt: -1 }).limit(1);

            if (recentSubscription) {
                subscriptionId = recentSubscription.stripeSubscriptionId;
                console.log('Using most recent subscription from database:', subscriptionId);
            }
        }

        if (!subscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'No subscription information provided',
                error: { status: 400, stack: '' }
            });
        }

        try {
            // Get subscription details from Stripe
            console.log('Attempting to retrieve subscription from Stripe:', subscriptionId);
            const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
            console.log('Retrieved subscription from Stripe:', stripeSubscription.id);

            // Find subscription in our database or create if not found
            let dbSubscription = await Subscription.findOne({ stripeSubscriptionId: subscriptionId });

            if (!dbSubscription) {
                console.log('Subscription not found in database, creating record');
                // Create a new record based on Stripe data
                dbSubscription = new Subscription({
                    stripeSubscriptionId: stripeSubscription.id,
                    customerId: stripeSubscription.customer,
                    status: stripeSubscription.status,
                    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                    plan: stripeSubscription.metadata.plan || 'unknown',
                    sku: stripeSubscription.metadata.sku || 'unknown',
                    email: stripeSubscription.metadata.email || 'unknown'
                });

                await dbSubscription.save();
                console.log('Created new subscription record in database');
            } else {
                // Update subscription status
                dbSubscription.status = stripeSubscription.status;
                dbSubscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
                await dbSubscription.save();
                console.log('Updated existing subscription record');
            }

            // Find the product details for the subscription
            const product = await Submission.findOne({ sku: dbSubscription.sku });

            // Send confirmation email
            if (dbSubscription.email) {
                try {
                    console.log('Sending subscription confirmation email to:', dbSubscription.email);
                    await sendSubscriptionConfirmation(dbSubscription, product);
                    console.log('Subscription confirmation email sent successfully');
                } catch (emailError) {
                    console.error('Error sending subscription confirmation email:', emailError);
                    // Continue with rendering the page even if email fails
                }
            }

            // Return JSON instead of rendering EJS template
            return res.json({
                success: true,
                subscription: {
                    _id: dbSubscription._id,
                    customerId: dbSubscription.customerId,
                    email: dbSubscription.email,
                    sku: dbSubscription.sku,
                    plan: dbSubscription.plan,
                    stripeSubscriptionId: dbSubscription.stripeSubscriptionId,
                    status: dbSubscription.status,
                    currentPeriodEnd: dbSubscription.currentPeriodEnd,
                    lastPaymentDate: dbSubscription.lastPaymentDate,
                    createdAt: dbSubscription.createdAt,
                    updatedAt: dbSubscription.updatedAt
                }
            });
        } catch (stripeError) {
            console.error('Error retrieving subscription from Stripe:', stripeError);

            // If we can't get the subscription from Stripe, check if we have it in our database
            const dbSubscription = await Subscription.findOne({ stripeSubscriptionId: subscriptionId });

            if (dbSubscription) {
                console.log('Using subscription from database only');

                // Find the product details for the subscription
                const product = await Submission.findOne({ sku: dbSubscription.sku });

                // Send confirmation email
                if (dbSubscription.email) {
                    try {
                        console.log('Sending subscription confirmation email to:', dbSubscription.email);
                        await sendSubscriptionConfirmation(dbSubscription, product);
                        console.log('Subscription confirmation email sent successfully');
                    } catch (emailError) {
                        console.error('Error sending subscription confirmation email:', emailError);
                        // Continue with rendering the page even if email fails
                    }
                }

                // Return JSON instead of rendering EJS template
                return res.json({
                    success: true,
                    subscription: {
                        _id: dbSubscription._id,
                        customerId: dbSubscription.customerId,
                        email: dbSubscription.email,
                        sku: dbSubscription.sku,
                        plan: dbSubscription.plan,
                        stripeSubscriptionId: dbSubscription.stripeSubscriptionId,
                        status: dbSubscription.status,
                        currentPeriodEnd: dbSubscription.currentPeriodEnd,
                        lastPaymentDate: dbSubscription.lastPaymentDate,
                        createdAt: dbSubscription.createdAt,
                        updatedAt: dbSubscription.updatedAt
                    }
                });
            }

            throw stripeError; // Re-throw to be caught by the outer catch
        }
    } catch (error) {
        console.error('Error loading subscription success page:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing your subscription. Please contact support.',
            error: {
                status: 500,
                stack: process.env.NODE_ENV === 'development' ? error.stack : '',
                message: error.message
            }
        });
    }
});

// Get metal data for charts 
async function getMetalData(e) {
    const t = `https://query1.finance.yahoo.com/v8/finance/chart/${e}?range=3mo&interval=1d`;
    try {
        const e = await axios.get(t),
            r = e.data.chart.result[0];
        if (!r) throw new Error("No data returned from Yahoo Finance");
        return {
            dates: r.timestamp.map(e => new Date(1e3 * e).toISOString().split("T")[0]),
            prices: r.indicators.quote[0].close
        }
    } catch (e) {
        return console.error("Error fetching data:", e), { dates: [], prices: [] }
    }
}

// Real-time price updates
async function emitRealTimeUpdates() {
    try {
        const prices = await getMetalPrices();
        
        // Only emit if we have valid prices (not all zeros)
        if (prices && Object.values(prices).some(price => price > 0)) {
            io.emit("updatePrices", prices);
        } else {
            console.log("Skipping price update - no valid prices received");
        }
    } catch (error) {
        console.error("Error emitting real-time updates:", error.message);
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

setInterval(emitRealTimeUpdates, 1e4);

// Root route
app.get("/", (req, res) => {
    if (process.env.NODE_ENV === 'development') {
        res.send('hello world')
    }
    else {
        res.redirect("https://www.spectragemsandminerals.com");
    }
});

// Data route
app.get("/data", async (req, res) => {
    try {
        let metalPrices = await getMetalPrices();
        const goldData = await getMetalData("GC=F");
        const silverData = await getMetalData("SI=F");
        const platinumData = await getMetalData("PL=F");
        const palladiumData = await getMetalData("PA=F");

        // Ensure we have valid prices with fallbacks
        metalPrices.Gold = metalPrices.Gold && metalPrices.Gold > 0 ? metalPrices.Gold : (goldData.prices.length > 0 ? goldData.prices.slice(-1)[0] / 28 : 2000);
        metalPrices.Silver = metalPrices.Silver && metalPrices.Silver > 0 ? metalPrices.Silver : (silverData.prices.length > 0 ? silverData.prices.slice(-1)[0] / 28 : 25);
        metalPrices.Platinum = metalPrices.Platinum && metalPrices.Platinum > 0 ? metalPrices.Platinum : (platinumData.prices.length > 0 ? platinumData.prices.slice(-1)[0] / 28 : 950);
        metalPrices.Palladium = metalPrices.Palladium && metalPrices.Palladium > 0 ? metalPrices.Palladium : (palladiumData.prices.length > 0 ? palladiumData.prices.slice(-1)[0] / 28 : 1000);

        // Return JSON instead of rendering EJS template
        res.json({
            metalPrices: metalPrices,
            goldData: goldData,
            silverData: silverData,
            platinumData: platinumData,
            palladiumData: palladiumData
        });
    } catch (error) {
        console.error('Error in data route:', error);
        // Return fallback data if everything fails
        res.json({
            metalPrices: {
                Gold: 2000,
                Silver: 25,
                Platinum: 950,
                Palladium: 1000
            },
            goldData: { dates: [], prices: [] },
            silverData: { dates: [], prices: [] },
            platinumData: { dates: [], prices: [] },
            palladiumData: { dates: [], prices: [] }
        });
    }
});

// Route to display sell confirmation page
app.get('/orders/sell-confirmation/:orderNumber', async (req, res) => {
    try {
        const orderNumber = req.params.orderNumber;

        // Find the order
        const order = await Order.findOne({ orderNumber });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found',
                error: { status: 404, stack: '' }
            });
        }

        // Check if it's a sell order
        if (order.action !== 'sell') {
            return res.status(400).json({
                success: false,
                message: 'Invalid order type',
                error: { status: 400, stack: '' }
            });
        }

        // Return JSON instead of rendering EJS template
        res.json({
            success: true,
            order: order.toObject()
        });
    } catch (error) {
        console.error('Error loading sell confirmation:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading sell confirmation',
            error: { status: 500, stack: process.env.NODE_ENV === 'development' ? error.stack : '' }
        });
    }
});

// Handle direct image uploads to Cloudinary
app.post('/upload-image', async (req, res) => {
    try {
        const fileStr = req.body.data;
        const uploadedResponse = await cloudinary.uploader.upload(fileStr, {
            upload_preset: 'metal_transactions'
        });
        res.json({ success: true, url: uploadedResponse.secure_url });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
});

// Handle form submissions
app.post('/submit-form', upload.single('image'), async (req, res) => {
    try {
        const { name, email, sku, description, action, metal, grams, calculatedPrice } = req.body;
        const id = Date.now();

        // Create a new submission document
        const newSubmission = new Submission({
            id: id,
            name,
            email,
            sku,
            description,
            metal,
            grams: parseFloat(grams) || 0,
            calculatedPrice,
            action: action || 'none',
            imagePath: req.file ? req.file.path : null
        });

        // Save to MongoDB
        await newSubmission.save();

        // Return success response with ID
        res.json({
            success: true,
            message: 'Thank you! Your submission has been received.',
            id: id
        });
    } catch (error) {
        console.error('Error saving submission:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing your submission. Please try again.',
            error: error.message
        });
    }
});

// API endpoint for SKU suggestions
app.get('/api/sku-suggestions', async (req, res) => {
    try {
        const searchTerm = req.query.term;

        if (!searchTerm || searchTerm.length < 2) {
            return res.json({ success: true, suggestions: [] });
        }

        // Escape special regex characters to prevent injection
        const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Find submissions with SKUs that match the search term (case-insensitive)
        // Use distinct to get unique SKUs directly from the database
        const suggestions = await Submission.distinct('sku', {
            sku: { $regex: escapedSearchTerm, $options: 'i' }
        });

        // Filter out any null or empty values and limit to 10 results
        const validSuggestions = suggestions.filter(Boolean).slice(0, 10);

        res.json({ success: true, suggestions: validSuggestions });
    } catch (error) {
        console.error('Error fetching SKU suggestions:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching suggestions',
            error: error.message
        });
    }
});

// Authentication middleware
const isAuthenticated = (req, res, next) => {
    // Try to get token from different sources
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.split(' ')[1];
    const queryToken = req.query.token;

    // Use token from header or query param
    const token = headerToken || queryToken;

    console.log('[AUTH] Header:', authHeader, '| HeaderToken:', headerToken, '| QueryToken:', queryToken, '| Using:', token);

    // If no token, return JSON error instead of redirecting
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            requiresAuth: true
        });
    }

    // Simple check - token should start with 'authenticated_'
    if (token.startsWith('authenticated_')) {
        return next();
    }

    // If token is invalid, return JSON error instead of redirecting
    res.status(401).json({
        success: false,
        message: 'Invalid authentication token',
        requiresAuth: true
    });
};

// Admin login page
app.get('/admin/login', (req, res) => {
    // Return JSON instead of rendering EJS template
    res.json({
        success: true,
        message: 'Admin login endpoint available'
    });
});

// Admin login POST endpoint
app.post('/admin/login', express.json(), (req, res) => {
    const { username, password } = req.body;

    // Get credentials from environment variables or use defaults for development
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'spectra2025';

    if (username === adminUsername && password === adminPassword) {
        // Generate simple token with timestamp
        const token = 'authenticated_' + Date.now();

        // Return token to client
        return res.json({
            success: true,
            token: token,
            redirect: '/admin/dashboard'
        });
    } else {
        // Invalid credentials
        return res.status(401).json({ error: 'Invalid username or password' });
    }
});

// Verify authentication token endpoint
app.post('/admin/verify-token', express.json(), (req, res) => {
    const { token } = req.body;

    // Simple verification - token should start with 'authenticated_'
    if (token && token.startsWith('authenticated_')) {
        return res.json({ valid: true });
    }

    // Invalid token
    res.json({ valid: false });
});

// Check session validity endpoint
app.get('/admin/check-session', (req, res) => {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    // Simple verification - token should start with 'authenticated_'
    if (token && token.startsWith('authenticated_')) {
        return res.json({ valid: true });
    }

    // Invalid token
    res.json({ valid: false });
});

// Admin logout - just a redirect since we're not storing sessions
app.get('/admin/logout', (req, res) => {
    res.redirect('/admin/login');
});

// Protected admin dashboard
app.get('/admin/dashboard', isAuthenticated, async (req, res) => {
    try {
        console.log('Admin dashboard requested - fetching data...');
        
        // Test database connection first
        const dbState = mongoose.connection.readyState;
        console.log('MongoDB connection state:', dbState, '(0=disconnected, 1=connected, 2=connecting, 3=disconnecting)');
        
        if (dbState !== 1) {
            console.error('MongoDB not connected!');
            return res.status(500).json({
                success: false,
                message: 'Database connection error',
                error: 'MongoDB not connected'
            });
        }
        
        // Get submissions from MongoDB
        console.log('Querying submissions...');
        const submissions = await Submission.find()
            .sort({ timestamp: -1 }); // Sort by timestamp descending
        console.log(`Found ${submissions.length} submissions`);

        // Get orders with their related submission data
        console.log('Querying orders...');
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .lean(); // Use lean to get plain JS objects
        console.log(`Found ${orders.length} orders`);

        // Get subscriptions
        console.log('Querying subscriptions...');
        const subscriptions = await Subscription.find()
            .sort({ createdAt: -1 })
            .lean();
        console.log(`Found ${subscriptions.length} subscriptions`);

        // Get claims
        console.log('Querying claims...');
        const claims = await Claim.find()
            .sort({ createdAt: -1 })
            .lean();
        console.log(`Found ${claims.length} claims`);

        console.log(`Total data found - Submissions: ${submissions.length}, Orders: ${orders.length}, Subscriptions: ${subscriptions.length}, Claims: ${claims.length}`);

        // Log first few items for debugging
        if (submissions.length > 0) {
            console.log('First submission:', {
                id: submissions[0].id,
                name: submissions[0].name,
                email: submissions[0].email,
                metal: submissions[0].metal
            });
        }
        
        if (orders.length > 0) {
            console.log('First order:', {
                orderNumber: orders[0].orderNumber,
                name: orders[0].name,
                status: orders[0].status
            });
        }
        
        if (subscriptions.length > 0) {
            console.log('First subscription:', {
                email: subscriptions[0].email,
                sku: subscriptions[0].sku,
                status: subscriptions[0].status
            });
        }
        
        if (claims.length > 0) {
            console.log('First claim:', {
                email: claims[0].email,
                sku: claims[0].sku,
                claimType: claims[0].claimType
            });
        }

        // Create an orders map for easy lookup by submissionId
        const ordersMap = {};
        orders.forEach(order => {
            if (order.submissionId) {
                ordersMap[order.submissionId.toString()] = order;
            }
        });

        // Create a map of submissions by SKU for easy lookup
        const submissionsBySku = {};
        submissions.forEach(submission => {
            if (submission.sku) {
                submissionsBySku[submission.sku] = submission;
            }
        });

        // Enrich subscription data with product details
        const enrichedSubscriptions = subscriptions.map(subscription => {
            const product = submissionsBySku[subscription.sku];
            return {
                ...subscription,
                product: product ? {
                    name: product.name,
                    metal: product.metal,
                    grams: product.grams,
                    calculatedPrice: product.calculatedPrice,
                    imagePath: product.imagePath
                } : null
            };
        });

        const responseData = {
            success: true,
            submissions: submissions.map(sub => ({
                _id: sub._id,
                id: sub.id,
                name: sub.name,
                email: sub.email,
                sku: sub.sku,
                description: sub.description,
                metal: sub.metal,
                grams: sub.grams,
                calculatedPrice: sub.calculatedPrice,
                action: sub.action,
                imagePath: sub.imagePath,
                timestamp: sub.timestamp
            })),
            orders: orders.map(order => ({
                _id: order._id,
                submissionId: order.submissionId,
                customerId: order.customerId,
                orderNumber: order.orderNumber,
                name: order.name,
                email: order.email,
                phone: order.phone,
                deliveryAddress: order.deliveryAddress,
                metal: order.metal,
                grams: order.grams,
                calculatedPrice: order.calculatedPrice,
                priceNumeric: order.priceNumeric,
                action: order.action,
                status: order.status,
                paymentStatus: order.paymentStatus,
                stripeSessionId: order.stripeSessionId,
                stripePaymentIntentId: order.stripePaymentIntentId,
                invoiceUrl: order.invoiceUrl,
                receiptUrl: order.receiptUrl,
                notes: order.notes,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt
            })),
            subscriptions: enrichedSubscriptions,
            claims: claims.map(claim => ({
                _id: claim._id,
                subscriptionId: claim.subscriptionId,
                customerId: claim.customerId,
                email: claim.email,
                sku: claim.sku,
                productDescription: claim.productDescription,
                images: claim.images,
                claimType: claim.claimType,
                notes: claim.notes,
                adminNotes: claim.adminNotes,
                createdAt: claim.createdAt,
                updatedAt: claim.updatedAt
            })),
            ordersMap
        };

        console.log('Sending admin dashboard response with data counts:', {
            submissions: responseData.submissions.length,
            orders: responseData.orders.length,
            subscriptions: responseData.subscriptions.length,
            claims: responseData.claims.length
        });

        // Return JSON instead of rendering EJS template
        res.json(responseData);
    } catch (error) {
        console.error('Error loading admin page:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Error loading data. Please try again.',
            error: error.message
        });
    }
});

// Admin redirect - return JSON instead of redirecting
app.get('/admin', (req, res) => {
    res.json({
        success: true,
        message: 'Admin endpoint available',
        redirectTo: '/admin/dashboard'
    });
});

// My subscriptions page
app.get('/my-subscriptions', async (req, res) => {
    try {
        // Check if user email is provided in query or session
        const userEmail = req.query.email || (req.session && req.session.userEmail);

        if (!userEmail) {
            return res.json({
                success: true,
                subscriptions: []
            });
        }

        // Find subscriptions for this user
        const subscriptions = await Subscription.find({ email: userEmail })
            .sort({ createdAt: -1 })
            .lean();

        // Create a map of submissions by SKU for easy lookup
        const skus = subscriptions.map(sub => sub.sku).filter(Boolean);
        const products = await Submission.find({ sku: { $in: skus } }).lean();

        const productsBySku = {};
        products.forEach(product => {
            if (product.sku) {
                productsBySku[product.sku] = product;
            }
        });

        // Enrich subscription data with product details
        const enrichedSubscriptions = subscriptions.map(subscription => {
            const product = productsBySku[subscription.sku];
            return {
                ...subscription,
                product: product ? {
                    name: product.name,
                    metal: product.metal,
                    grams: product.grams,
                    calculatedPrice: product.calculatedPrice,
                    imagePath: product.imagePath
                } : null
            };
        });

        // Return JSON instead of rendering EJS template
        res.json({
            success: true,
            subscriptions: enrichedSubscriptions
        });
    } catch (error) {
        console.error('Error loading subscriptions page:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading your subscriptions. Please try again later.',
            error: {
                status: 500,
                stack: process.env.NODE_ENV === 'development' ? error.stack : '',
                message: error.message
            }
        });
    }
});

// Retrieve payment intent for incomplete subscription
app.post('/retrieve-subscription-payment', express.json(), async (req, res) => {
    try {
        const { subscriptionId } = req.body;

        if (!subscriptionId) {
            return res.status(400).json({
                error: {
                    message: 'Missing subscription ID'
                }
            });
        }

        // Initialize Stripe
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        // Get subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice.payment_intent']
        });

        // Check if there's a payment intent available
        if (!subscription.latest_invoice || !subscription.latest_invoice.payment_intent) {
            return res.status(404).json({
                error: {
                    message: 'No payment information found for this subscription'
                }
            });
        }

        // Return the client secret for the payment intent
        res.json({
            clientSecret: subscription.latest_invoice.payment_intent.client_secret
        });
    } catch (error) {
        console.error('Error retrieving subscription payment:', error.message);
        console.error('Error details:', {
            stack: error.stack,
            code: error.code,
            type: error.type
        });

        res.status(500).json({
            error: {
                message: error.message || 'Could not retrieve payment information'
            }
        });
    }
});

// Subscription cancellation endpoint
app.post('/subscriptions/:id/cancel', async (req, res) => {
    try {
        const subscriptionId = req.params.id;

        // Initialize Stripe
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        // Cancel the subscription in Stripe
        const canceledSubscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });

        // Update the subscription in our database
        await Subscription.findOneAndUpdate(
            { stripeSubscriptionId: subscriptionId },
            {
                status: 'canceled',
                canceledAt: new Date()
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Could not cancel subscription'
        });
    }
});

// Claim routes
app.post('/claims/create', upload.array('images', 10), async (req, res) => {
    try {
        const { subscriptionId, productDescription, claimType, notes } = req.body;
        const images = req.files;

        if (!subscriptionId || !productDescription || !claimType) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: subscriptionId, productDescription, and claimType are required'
            });
        }

        // Find the subscription to verify it exists and is active
        const subscription = await Subscription.findById(subscriptionId);
        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        if (subscription.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'Only active subscriptions can file claims'
            });
        }

        // Upload images to Cloudinary if provided
        const uploadedImages = [];
        if (images && images.length > 0) {
            for (const image of images) {
                try {
                    const result = await cloudinary.uploader.upload(image.path, {
                        folder: 'claims',
                        resource_type: 'auto'
                    });
                    uploadedImages.push({
                        url: result.secure_url,
                        filename: result.original_filename || image.originalname,
                        uploadedAt: new Date()
                    });
                } catch (uploadError) {
                    console.error('Error uploading image:', uploadError);
                    // Continue with other images even if one fails
                }
            }
        }

        // Create the claim
        const claim = new Claim({
            subscriptionId: subscription._id,
            customerId: subscription.customerId,
            email: subscription.email,
            sku: subscription.sku,
            productDescription,
            images: uploadedImages,
            claimType,
            notes
        });

        await claim.save();
        console.log('Claim saved successfully:', {
            _id: claim._id,
            email: claim.email,
            sku: claim.sku,
        });

        res.json({
            success: true,
            claim: {
                _id: claim._id,
                subscriptionId: claim.subscriptionId,
                customerId: claim.customerId,
                email: claim.email,
                sku: claim.sku,
                productDescription: claim.productDescription,
                images: claim.images,
                claimType: claim.claimType,
                notes: claim.notes,
                createdAt: claim.createdAt,
                updatedAt: claim.updatedAt
            },
            message: 'Claim submitted successfully'
        });
    } catch (error) {
        console.error('Error creating claim:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create claim',
            error: error.message
        });
    }
});

app.get('/claims', async (req, res) => {
    try {
        const { email } = req.query;

        console.log('Claims requested for email:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email parameter is required'
            });
        }

        // Find claims for the user
        const claims = await Claim.find({ email })
            .sort({ createdAt: -1 })
            .lean();

        console.log(`Found ${claims.length} claims for email: ${email}`);
        if (claims.length > 0) {
            console.log('First claim:', {
                _id: claims[0]._id,
                email: claims[0].email,
                sku: claims[0].sku,
                status: claims[0].status
            });
        }

        res.json({
            success: true,
            claims: claims.map(claim => ({
                _id: claim._id,
                subscriptionId: claim.subscriptionId,
                customerId: claim.customerId,
                email: claim.email,
                sku: claim.sku,
                productDescription: claim.productDescription,
                images: claim.images,
                claimType: claim.claimType,
                notes: claim.notes,
                adminNotes: claim.adminNotes,
                createdAt: claim.createdAt,
                updatedAt: claim.updatedAt
            }))
        });
    } catch (error) {
        console.error('Error fetching claims:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch claims',
            error: error.message
        });
    }
});

// Test endpoint to verify database connection and data
app.get('/admin/test-db', async (req, res) => {
    try {
        console.log('Testing database connection...');
        
        const dbState = mongoose.connection.readyState;
        console.log('MongoDB connection state:', dbState);
        
        if (dbState !== 1) {
            return res.json({
                success: false,
                message: 'Database not connected',
                state: dbState
            });
        }
        
        // Test queries
        const submissionCount = await Submission.countDocuments();
        const orderCount = await Order.countDocuments();
        const subscriptionCount = await Subscription.countDocuments();
        
        // Get sample data
        const sampleSubmission = await Submission.findOne();
        const sampleOrder = await Order.findOne();
        const sampleSubscription = await Subscription.findOne();
        
        res.json({
            success: true,
            connection: 'Connected',
            counts: {
                submissions: submissionCount,
                orders: orderCount,
                subscriptions: subscriptionCount
            },
            samples: {
                submission: sampleSubmission ? {
                    id: sampleSubmission.id,
                    name: sampleSubmission.name,
                    email: sampleSubmission.email
                } : null,
                order: sampleOrder ? {
                    orderNumber: sampleOrder.orderNumber,
                    name: sampleOrder.name,
                    status: sampleOrder.status
                } : null,
                subscription: sampleSubscription ? {
                    email: sampleSubscription.email,
                    sku: sampleSubscription.sku,
                    status: sampleSubscription.status
                } : null
            }
        });
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            success: false,
            message: 'Database test failed',
            error: error.message
        });
    }
});

// Error handling middleware
app.use((req, res, next) => {
    // Return JSON for all routes
    return res.status(404).json({
        success: false,
        error: {
            message: 'Route not found',
            status: 404
        }
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);

    // Return JSON for all routes
    return res.status(err.status || 500).json({
        success: false,
        error: {
            message: err.message || 'Something went wrong!',
            status: err.status || 500
        }
    });
});

module.exports = app;
