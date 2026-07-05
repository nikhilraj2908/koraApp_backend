const Wallet = require("../models/WalletCustomer");
const Customer = require("../models/Customer");

// GET /api/wallet — balance + transaction history for the logged-in customer
exports.getWallet = async (req, res) => {
  try {
    // req.user.id is the Account _id (see middleware/auth.js + authController's
    // JWT payload), so the Customer document must be resolved via accountId —
    // it is NOT the same as Customer._id.
    const customer = await Customer.findOne({ accountId: req.user.id });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found",
      });
    }

    let wallet = await Wallet.findOne({ customerId: customer._id });

    if (!wallet) {
      wallet = await Wallet.create({
        customerId: customer._id,
        balance: 0,
        transactions: [],
      });
    }

    const transactions = [...wallet.transactions]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((txn) => ({
        id: txn._id,
        type: txn.type,
        amount: txn.amount,
        reason: txn.reason,
        orderNumber: txn.orderNumber || null,
        createdAt: txn.createdAt,
      }));

    res.json({
      success: true,
      data: {
        balance: wallet.balance,
        transactions,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};