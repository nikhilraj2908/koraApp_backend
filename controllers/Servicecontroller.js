const Service = require("../models/Servicemodel");

const sendSuccess = (res, data, statusCode = 200, meta = {}) =>
  res.status(statusCode).json({ success: true, data, ...meta });

const sendError = (res, message, statusCode = 500, errors = null) =>
  res.status(statusCode).json({ success: false, message, ...(errors && { errors }) });


exports.getAllServices = async (req, res) => {
  try {
    const { includeInactive = false, limit, offset = 0 } = req.query;

    const filter = includeInactive === "true" ? {} : { isActive: true };

    const total = await Service.countDocuments(filter);
    const query = Service.find(filter).sort({ sortOrder: 1 });

    if (limit) {
      query.skip(parseInt(offset)).limit(parseInt(limit));
    }

    const services = await query;

    return sendSuccess(res, services, 200, {
      meta: { total, limit: limit || total, offset: parseInt(offset) },
    });
  } catch (err) {
    console.error("[getAllServices]", err);
    return sendError(res, "Failed to fetch services.");
  }
};


exports.getServiceById = async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return sendError(res, "Service not found.", 404);
    return sendSuccess(res, service);
  } catch (err) {
    console.error("[getServiceById]", err);
    return sendError(res, "Failed to fetch service.");
  }
};


exports.getServiceBySlug = async (req, res) => {
  try {
    const service = await Service.findOne({ slug: req.params.slug });
    if (!service) return sendError(res, "Service not found.", 404);
    return sendSuccess(res, service);
  } catch (err) {
    console.error("[getServiceBySlug]", err);
    return sendError(res, "Failed to fetch service.");
  }
};


exports.createService = async (req, res) => {
  try {
    const { name, slug, description, pricePerPair, estimatedHours, sortOrder } =
      req.body;

    if (!name || !slug || pricePerPair === undefined) {
      return sendError(res, "name, slug, and pricePerPair are required.", 400);
    }

    const existing = await Service.findOne({ $or: [{ name }, { slug }] });
    if (existing) return sendError(res, "A service with this name or slug already exists.", 409);

    const service = await Service.create({
      name,
      slug,
      description,
      pricePerPair,
      estimatedHours,
      sortOrder,
    });

    return sendSuccess(res, service, 201);
  } catch (err) {
    console.error("[createService]", err);
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return sendError(res, "Validation failed.", 422, errors);
    }
    return sendError(res, "Failed to create service.");
  }
};


exports.updateService = async (req, res) => {
  try {
    const allowedFields = [
      "name", "slug", "description", 
      "pricePerPair", "estimatedHours",
       "isActive", "sortOrder",
    ];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
    );

    const service = await Service.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!service) return sendError(res, "Service not found.", 404);
    return sendSuccess(res, service);
  } catch (err) {
    console.error("[updateService]", err);
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return sendError(res, "Validation failed.", 422, errors);
    }
    return sendError(res, "Failed to update service.");
  }
};


exports.toggleServiceStatus = async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return sendError(res, "Service not found.", 404);

    service.isActive = !service.isActive;
    await service.save();

    return sendSuccess(res, { id: service._id, isActive: service.isActive });
  } catch (err) {
    console.error("[toggleServiceStatus]", err);
    return sendError(res, "Failed to toggle service status.");
  }
};


exports.deleteService = async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) return sendError(res, "Service not found.", 404);
    return sendSuccess(res, { message: "Service deleted successfully." });
  } catch (err) {
    console.error("[deleteService]", err);
    return sendError(res, "Failed to delete service.");
  }
};


exports.seedServices = async (req, res) => {
  try {
    const seedData = [
      { name: "Wash",        slug: "wash",      icon: "wash",      color: "#00BFA5", pricePerPair: 30, estimatedHours: 24, sortOrder: 1 },
      { name: "Iron",        slug: "iron",      icon: "iron",      color: "#F5A623", pricePerPair: 20, estimatedHours: 12, sortOrder: 2 },
      { name: "Wash + Iron", slug: "wash-iron", icon: "wash-iron", color: "#4CAF50", pricePerPair: 45, estimatedHours: 36, sortOrder: 3 },
    ];

    await Promise.all(
      seedData.map((s) =>
        Service.findOneAndUpdate({ slug: s.slug }, s, { upsert: true, new: true })
      )
    );

    const services = await Service.find().sort({ sortOrder: 1 });
    return sendSuccess(res, services, 201);
  } catch (err) {
    console.error("[seedServices]", err);
    return sendError(res, "Seeding failed.");
  }
};