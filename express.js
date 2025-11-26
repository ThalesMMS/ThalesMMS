import "dotenv/config";
import langCard from "./api/top-langs.js";
import express from "express";

const app = express();
const router = express.Router();

router.get("/top-langs", langCard);

app.use("/api", router);

const port = process.env.PORT || process.env.port || 9000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
