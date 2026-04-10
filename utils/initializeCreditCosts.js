const mongoose = require('mongoose');
const CreditCost = require('../models/CreditCost');



/*
 * Update existing credit cost
 */
const updateCreditCost = async (actionType, newCredits, newDescription) => {
  try {
    const updatedCost = await CreditCost.findOneAndUpdate(
      { actionType: actionType },
      {
        credits: newCredits,
        description: newDescription || undefined,
        updatedAt: new Date()
      },
      { returnDocument: 'after' }
    );

    if (!updatedCost) {
      throw new Error(`Credit cost not found for action: ${actionType}`);
    }

    console.log(`Updated ${actionType}: ${updatedCost.credits} credits`);
    return { success: true, data: updatedCost };

  } catch (error) {
    console.error('Error updating credit cost:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all current credit costs
 */
const getCurrentCosts = async () => {
  try {
    const costs = await CreditCost.find({ isActive: true }).sort({ actionType: 1 });
    return { success: true, data: costs };
  } catch (error) {
    console.error('Error fetching current costs:', error);
    return { success: false, error: error.message };
  }
};

// Export functions for use in other scripts or API endpoints
module.exports = {
  updateCreditCost,
  getCurrentCosts
};

// If this script is run directly (not imported), initialize the costs
if (require.main === module) {
  // Note: Make sure to connect to MongoDB before running this
  console.log('Run this script after connecting to MongoDB');
  console.log('Example usage:');
  console.log('const { initializeCreditCosts } = require("./utils/initializeCreditCosts");');
  console.log('await initializeCreditCosts();');
}