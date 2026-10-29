/**
 * CrewMatch matching configuration.
 *
 * This is the ONE file to edit to change how matching behaves.
 * Weights are relative: they do not need to add up to 1 or 100.
 * Doubling a weight doubles how much that factor counts compared to the others.
 * Set a weight to 0 to switch a factor off.
 *
 * Nothing in this file is ever shown to crew or productions.
 */
module.exports = {
  weights: {
    roleFit: 30,        // Does the crew member do this job (or work in this department)?
    skillsGear: 15,     // Share of the position's required skills and gear they have.
    location: 10,       // How close they are, inside their own travel radius.
    availability: 20,   // Share of the shoot days they are free.
    rate: 10,           // How well their day-rate range fits the position's range.
    daysSinceWorked: 10, // Fairness: people who have waited longer rise a little.
    reliability: 5,     // Confirmed jobs versus cancellations.
  },

  roleFit: {
    primaryRole: 1.0,     // The position's role is the crew member's main role.
    secondaryRole: 0.85,  // The role is one of their other roles.
    sameDepartment: 0.4,  // Different role, same department (e.g. a 2nd AC for a 1st AC job).
    // Anything else scores 0 and is never shown.
  },

  location: {
    // Inside the travel radius the score falls from 1.0 (same place)
    // to this value (right at the edge of the radius).
    scoreAtEdgeOfRadius: 0.5,
    // Crew always count as local within this distance, even with a radius of 0.
    alwaysLocalKm: 15,
    // Beyond their radius a crew member is never shown.
  },

  availability: {
    // Crew free for less than this share of the shoot days are not shown.
    minimumShare: 0.5,
  },

  rate: {
    // If the crew member's minimum is above the position's maximum, the score
    // drops by this much for each 10% they are above it.
    penaltyPer10PercentOver: 0.35,
  },

  daysSinceWorked: {
    // Days without a confirmed job at which this factor reaches its maximum.
    capDays: 90,
    // Value used for crew who have never had a confirmed job on CrewMatch.
    noHistoryDays: 30,
  },

  reliability: {
    // A starting "benefit of the doubt" so new crew are not punished.
    priorConfirmed: 3,
    priorCancelled: 1,
  },

  // Crew below this overall score (0 to 1) are not shown anywhere.
  minimumScore: 0.45,
  // How many crew a production sees per position.
  shortlistSize: 8,
  // How many matched jobs a crew member sees.
  crewFeedSize: 20,
};
