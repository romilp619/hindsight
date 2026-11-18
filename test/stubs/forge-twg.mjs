export const twgState = { objects: [] };
export const graph = { async setObjects(req) { twgState.objects.push(...req.objects); return { success: true }; } };
export default graph;
