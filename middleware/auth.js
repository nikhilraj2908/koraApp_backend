const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const washerprotect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ success: false, message: "No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Role ke hisaab se user fetch karo
    if (decoded.role === "washer") {
      req.user = await Washer.findById(decoded.id).select("-password");
    } else {
      req.user = await Customer.findById(decoded.id).select("-password");
    }

    if (!req.user)
      return res.status(401).json({ success: false, message: "User not found" });

    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

module.exports = { protect, restrictTo, washerprotect };