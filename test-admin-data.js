const mongoose = require('mongoose');
const Submission = require('./models/Submission');
const Order = require('./models/Order');
const Subscription = require('./models/Subscription');

async function testAdminData() {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://localhost:27017/spectra', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        console.log('Connected to MongoDB');
        
        // Test submissions
        const submissions = await Submission.find().sort({ timestamp: -1 });
        console.log(`Found ${submissions.length} submissions:`);
        submissions.slice(0, 3).forEach(sub => {
            console.log(`- ID: ${sub.id}, Name: ${sub.name}, Email: ${sub.email}, Metal: ${sub.metal}, Action: ${sub.action}`);
        });
        
        // Test orders
        const orders = await Order.find().sort({ createdAt: -1 });
        console.log(`\nFound ${orders.length} orders:`);
        orders.slice(0, 3).forEach(order => {
            console.log(`- Order: ${order.orderNumber}, Name: ${order.name}, Status: ${order.status}, Payment: ${order.paymentStatus}`);
        });
        
        // Test subscriptions
        const subscriptions = await Subscription.find().sort({ createdAt: -1 });
        console.log(`\nFound ${subscriptions.length} subscriptions:`);
        subscriptions.slice(0, 3).forEach(sub => {
            console.log(`- Email: ${sub.email}, SKU: ${sub.sku}, Status: ${sub.status}, Plan: ${sub.plan}`);
        });
        
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
        
    } catch (error) {
        console.error('Error testing admin data:', error);
    }
}

testAdminData(); 