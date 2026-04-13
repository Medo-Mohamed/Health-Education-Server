import mongoose from "mongoose";

const followSchema = new mongoose.Schema({
  // المستخدم الذي قام بالمتابعة
  follower: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // المستخدم الذي تم استلام المتابعة منه
  following: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// منع تكرار المتابعة (لا يمكن للشخص متابعة نفس الشخص مرتين)
followSchema.index({ follower: 1, following: 1 }, { unique: true });

const Follow = mongoose.model("Follow", followSchema);

export default Follow;
