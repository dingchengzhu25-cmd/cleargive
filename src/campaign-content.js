// Public editorial copy for the prepared examples. Original signed metadata stays
// unchanged; contractTitle remains available in the fixed-terms view and exports.
export const CAMPAIGN_CONTENT = {
 collecting: {
  title: 'Fresh Groceries for Bedok Families', image: 'groceries', category: 'Food security', location: 'Bedok, Singapore',
  description: 'Help families stretch their weekly food budget with fresh vegetables, eggs and pantry staples. This volunteer-led appeal plans grocery packs for households in Bedok, with supplies purchased from the campaign’s named food supplier.',
  photoAlt: 'A reusable grocery bag filled with fresh produce and eggs',
 },
 funded: {
  title: 'Weekend Lunches for Homebound Seniors', image: 'seniors', category: 'Food security', location: 'Singapore',
  description: 'Support older neighbours who find it difficult to shop or cook for themselves. This appeal funds ingredients and meal supplies for volunteer-prepared weekend lunches, helping seniors enjoy a nourishing meal at home.',
  photoAlt: 'An older couple sharing a meal at home',
 },
 revised: {
  title: 'A Reading Corner for Tampines Children', image: 'school', category: 'Education', location: 'Tampines, Singapore',
  description: 'Give children a welcoming place to discover their next favourite story. This neighbourhood initiative aims to equip a shared reading corner with age-appropriate books and reading materials for after-school sessions.',
  photoAlt: 'Children reading books together in a classroom',
 },
 ready: {
  title: 'Braille Books for Young Readers', image: 'braille', category: 'Education', location: 'Singapore',
  description: 'Make story time more accessible to children with visual impairments. This appeal supports the purchase of Braille books and tactile reading materials so young readers can explore stories through touch.',
  photoAlt: 'Hands reading the raised dots of a Braille book',
 },
 rejected: {
  title: 'A Safe Kitchen for Community Cooks', image: 'kitchen', category: 'Food security', location: 'Singapore',
  description: 'Help volunteer cooks prepare meals in a better-equipped shared kitchen. The project seeks durable cookware and food-preparation supplies for community meal sessions, with purchases tied to the agreed supplier order.',
  photoAlt: 'A cook preparing food with cookware in a kitchen',
 },
 'partial-paid': {
  title: 'Study Spaces for After-School Learners', image: 'study', category: 'Education', location: 'Singapore',
  description: 'Help children who lack a quiet study space take part in after-school learning sessions. This project brings together learning supplies and classroom equipment in two supplier orders to support a practical, welcoming place to study.',
  photoAlt: 'A student writing in a notebook at a study desk',
 },
 'delivery-pending': {
  title: 'School Bags for a Confident First Day', image: 'backpacks', category: 'Education', location: 'Singapore',
  description: 'A dependable school bag can make the start of term a little easier. This appeal funds backpacks for students whose families need help with school essentials, through a fixed order with the campaign’s education supplier.',
  photoAlt: 'A student holding a backpack in a classroom',
 },
 delivered: {
  title: 'Restore the Punggol Community Garden', image: 'garden', category: 'Environment', location: 'Punggol, Singapore',
  description: 'Bring neighbours together around a greener shared space. This resident-led project supports garden supplies for planting and maintaining a community growing area, giving volunteers a place to learn, grow and care for their neighbourhood.',
  photoAlt: 'Volunteers tending plants in a community garden',
 },
 'partial-refund': {
  title: 'Learning Kits for a Fresh Start', image: 'learning-kits', category: 'Education', location: 'Singapore',
  description: 'Help students begin a new term with the basics they need to learn. This appeal plans two orders of learning materials and classroom essentials, supporting children whose families face the cost of school supplies.',
  photoAlt: 'Notebooks, pencils and other school supplies arranged on a desk',
 },
 'funding-refund': {
  title: 'A Mobile Pantry for Isolated Neighbours', image: 'pantry', category: 'Food security', location: 'Singapore',
  description: 'Bring everyday food essentials closer to neighbours who struggle to reach a grocery shop. This appeal aims to purchase pantry supplies for volunteer-led doorstep deliveries to households with limited mobility or transport.',
  photoAlt: 'Volunteers loading food donation boxes beside a delivery vehicle',
 },
 'credit-refund': {
  title: 'Breakfast Boxes for Early-Shift Workers', image: 'breakfast', category: 'Food security', location: 'Singapore',
  description: 'Help low-income workers start an early shift with a filling breakfast. The appeal aims to purchase food supplies for packed morning meals, with volunteers coordinating collection and distribution before the working day begins.',
  photoAlt: 'A packed takeaway breakfast with rice, egg and vegetables',
 },
 'credit-onward': {
  title: 'Newborn Essentials for New Parents', image: 'newborn', category: 'Family support', location: 'Singapore',
  description: 'Welcome new babies with practical support for their first weeks. This community appeal aims to provide basic baby clothing and everyday care supplies for parents who need help with the cost of newborn essentials.',
  photoAlt: 'Soft baby clothes, hats and socks arranged on a bedspread',
 },
};

export function campaignPresentation(metadata, contractTitle) {
 const content = metadata?.scenarioLibraryVersion === 2 ? CAMPAIGN_CONTENT[metadata.scenarioKey] : null;
 return {...metadata, ...(content || {}), contractTitle, title:content?.title || contractTitle};
}

const photos = new Set(['school','pantry','garden', ...Object.values(CAMPAIGN_CONTENT).map(c=>c.image)]);
export const campaignPhoto = campaign => photos.has(campaign.image) ? campaign.image : 'school';
