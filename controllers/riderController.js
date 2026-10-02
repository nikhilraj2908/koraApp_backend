const bcrypt = require('bcrypt');
const Rider = require('../models/Rider');
const Account = require('../models/Account');
const { notifyAdmins } = require('../utils/notification');

/**
 * POST /api/riders/enroll & POST /api/riders/auth/register
 * Enroll/register a new delivery rider and submit documents for admin verification
 */
exports.enrollRider = async (req, res) => {
  let account;
  try {
    const {
      fullName,
      mobile,
      email,
      password,
      dob,
      gender,
      permanentAddress,
      currentAddress,
      preferredLocation,
      emergencyContactName,
      emergencyContactMobile,
      vehicleType,
      vehicleRegNo,
    } = req.body;

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedMobile = (mobile || '').replace(/\D/g, '');
    const declarationsAccepted =
      req.body.declarationsAccepted === 'true' ||
      req.body.declarationsAccepted === true;
    const isCycle = vehicleType === 'Cycle';

    const aadhaarFront = req.files?.aadhaarFront?.[0];
    const aadhaarBack = req.files?.aadhaarBack?.[0];
    const drivingLicense = req.files?.drivingLicense?.[0];
    const rc = req.files?.rc?.[0];
    const profilePhoto = req.files?.profilePhoto?.[0];

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        success: false,
        message: 'A valid current GPS location is required.',
      });
    }

    if (
      !fullName ||
      normalizedMobile.length !== 10 ||
      !normalizedEmail ||
      !password ||
      !dob ||
      !gender ||
      !permanentAddress ||
      !currentAddress
    ) {
      return res.status(400).json({
        success: false,
        message: 'All required personal details must be provided',
      });
    }

    if (!aadhaarFront || !aadhaarBack || !profilePhoto) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar front, Aadhaar back and profile photo are required',
      });
    }

    if (!vehicleType) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type is required',
      });
    }

    if (!isCycle && (!vehicleRegNo || !rc)) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle registration number and RC document are required for motorised vehicles',
      });
    }

    if (!declarationsAccepted) {
      return res.status(400).json({
        success: false,
        message: 'All declarations must be accepted',
      });
    }

    const existingMobile = await Account.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is already registered',
      });
    }

    const existingEmail = await Account.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is already registered',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    account = await Account.create({
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      role: 'rider',
    });

    const { findServiceAreaForPoint } = require('../services/serviceAreaService');
    const match = await findServiceAreaForPoint(longitude, latitude);
    let matchedServiceAreaId = null;
    if (match.matched && match.serviceArea) {
      matchedServiceAreaId = match.serviceArea._id;
    }

    const riderData = {
      accountId: account._id,
      fullName: fullName.trim(),
      dob: new Date(dob),
      gender,
      permanentAddress: permanentAddress.trim(),
      currentAddress: currentAddress.trim(),
      preparedLocation: preferredLocation
        ? { address: preferredLocation.trim() }
        : undefined,
      baseLocation: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
      serviceAreaId: matchedServiceAreaId,
      currentLocation: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
      locationUpdatedAt: new Date(),
      emergencyContact: {
        name: (emergencyContactName || '').trim(),
        mobile: (emergencyContactMobile || '').replace(/\D/g, ''),
      },
      vehicleType,
      vehicleRegNo: !isCycle && vehicleRegNo ? vehicleRegNo.trim().toUpperCase() : undefined,
      documents: {
        aadhaarFront: aadhaarFront?.filename
          ? `/uploads/${aadhaarFront.filename}`
          : aadhaarFront?.path || '',
        aadhaarBack: aadhaarBack?.filename
          ? `/uploads/${aadhaarBack.filename}`
          : aadhaarBack?.path || '',
        drivingLicense: drivingLicense?.filename
          ? `/uploads/${drivingLicense.filename}`
          : drivingLicense?.path || undefined,
        rc: !isCycle && rc?.filename
          ? `/uploads/${rc.filename}`
          : rc?.path || undefined,
        profilePhoto: profilePhoto?.filename
          ? `/uploads/${profilePhoto.filename}`
          : profilePhoto?.path || '',
      },
      declarationsAccepted: true,
      verificationStatus: 'pending',
      isVerified: false,
    };

    const rider = await Rider.create(riderData);

    // Notify admins for pending verification review
    notifyAdmins({
      type: 'rider_signup',
      title: 'New rider signup',
      body: `${fullName} submitted their profile for verification`,
      referenceId: rider._id,
      referenceModel: 'Rider',
    });

    return res.status(201).json({
      success: true,
      message: 'Rider registration submitted for verification',
      rider: { id: rider._id, verificationStatus: rider.verificationStatus },
    });
  } catch (err) {
    if (account?._id) {
      await Account.deleteOne({ _id: account._id }).catch(() => undefined);
    }
    console.error('Rider enrollment error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/riders/profile
 * Get authenticated rider profile with populated account details
 */
exports.getProfile = async (req, res) => {
  try {
    const riderId = req.rider?._id || req.user?.riderId;
    if (!riderId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rider = await Rider.findById(riderId).populate({
      path: 'accountId',
      select: 'email mobile role isVerified createdAt',
    });

    if (!rider) {
      return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    const riderObj = rider.toObject ? rider.toObject() : rider;
    const formattedData = {
      ...riderObj,
      name: riderObj.fullName || riderObj.name || '',
      mobile: riderObj.accountId?.mobile || riderObj.mobile || '',
      email: riderObj.accountId?.email || riderObj.email || '',
    };

    return res.json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/riders/profile
 * Update authenticated rider profile (safe mutable fields)
 */
exports.updateProfile = async (req, res) => {
  try {
    const riderId = req.rider?._id || req.user?.riderId;
    if (!riderId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const allowedFields = [
      'fullName',
      'currentAddress',
      'permanentAddress',
      'preparedLocation',
      'emergencyContact',
      'vehicleType',
      'vehicleRegNo',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (typeof updates.fullName === 'string') updates.fullName = updates.fullName.trim();
    if (typeof updates.currentAddress === 'string') updates.currentAddress = updates.currentAddress.trim();
    if (typeof updates.permanentAddress === 'string') updates.permanentAddress = updates.permanentAddress.trim();
    if (typeof updates.vehicleRegNo === 'string') updates.vehicleRegNo = updates.vehicleRegNo.trim().toUpperCase();

    // Permanent base location assignment and service area resolution
    if (req.body.baseLocation?.coordinates || (req.body.latitude !== undefined && req.body.longitude !== undefined)) {
      const bLng = req.body.baseLocation?.coordinates ? Number(req.body.baseLocation.coordinates[0]) : Number(req.body.longitude);
      const bLat = req.body.baseLocation?.coordinates ? Number(req.body.baseLocation.coordinates[1]) : Number(req.body.latitude);

      const { findServiceAreaForPoint } = require('../services/serviceAreaService');
      const match = await findServiceAreaForPoint(bLng, bLat);

      if (match.conflict) {
        return res.status(409).json({
          success: false,
          code: 'MULTIPLE_SERVICE_AREAS_MATCH',
          message: 'This base location falls inside multiple active service areas.',
        });
      }

      if (!match.matched || !match.serviceArea) {
        return res.status(422).json({
          success: false,
          code: 'OUTSIDE_SERVICE_AREA',
          message: 'Rider base location is outside all active KORA service areas.',
        });
      }

      updates.baseLocation = { type: 'Point', coordinates: [bLng, bLat] };
      updates.serviceAreaId = match.serviceArea._id;
    }

    const rider = await Rider.findByIdAndUpdate(
      riderId,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate({
      path: 'accountId',
      select: 'email mobile role isVerified createdAt',
    });

    if (!rider) {
      return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: rider,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};