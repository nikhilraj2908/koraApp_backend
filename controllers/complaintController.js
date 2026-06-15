const Complaint = require('../models/Complaint');

// Submit a new complaint (user)
exports.createComplaint = async (req, res) => {
  try {
    const { category, orderId, subject, description } = req.body;
    let photoUrl = '';
    if (req.file) {
      photoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    const complaint = new Complaint({
      user: req.user.id,        // req.user comes from protect middleware
      category,
      orderId: orderId || '',
      subject,
      description,
      photoUrl,
    });
    await complaint.save();
    res.status(201).json({ success: true, message: 'Complaint submitted', complaint });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get logged-in user's complaints
exports.getUserComplaints = async (req, res) => {
  try {
    const complaints = await Complaint.find({ user: req.user.id })
      .sort({ createdAt: -1 });
    res.json({ success: true, complaints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a single complaint by ID (owner or admin)
exports.getComplaintById = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    // Allow owner or admin (role check)
    if (complaint.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json({ success: true, complaint });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: get all complaints
exports.getAllComplaints = async (req, res) => {
  try {
    const complaints = await Complaint.find()
      .populate('user', 'name email')   // populate from your user model
      .sort({ createdAt: -1 });
    res.json({ success: true, complaints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: update complaint status & remarks
exports.updateComplaintStatus = async (req, res) => {
  try {
    const { status, adminRemarks } = req.body;
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    if (status) complaint.status = status;
    if (adminRemarks) complaint.adminRemarks = adminRemarks;
    await complaint.save();
    res.json({ success: true, complaint });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};