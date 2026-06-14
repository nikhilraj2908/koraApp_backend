const ComplaintCategory = require('../models/ComplaintCategory');

// Get all active complaint categories (public / user)
exports.getComplaintCategories = async (req, res) => {
  try {
    const categories = await ComplaintCategory.find({ isActive: true })
      .sort({ displayOrder: 1 });
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: create complaint category
exports.createComplaintCategory = async (req, res) => {
  try {
    const { name, subCategories, displayOrder } = req.body;
    const existing = await ComplaintCategory.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Complaint category already exists' });
    }
    const category = new ComplaintCategory({
      name,
      subCategories: subCategories || [],
      displayOrder: displayOrder || 0,
    });
    await category.save();
    res.status(201).json({ success: true, category });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: update complaint category
exports.updateComplaintCategory = async (req, res) => {
  try {
    const { name, subCategories, isActive, displayOrder } = req.body;
    const category = await ComplaintCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Complaint category not found' });
    }
    if (name) category.name = name;
    if (subCategories) category.subCategories = subCategories;
    if (isActive !== undefined) category.isActive = isActive;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    await category.save();
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: delete complaint category
exports.deleteComplaintCategory = async (req, res) => {
  try {
    const category = await ComplaintCategory.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Complaint category not found' });
    }
    res.json({ success: true, message: 'Complaint category deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};