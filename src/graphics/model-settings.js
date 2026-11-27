import catalog from '../../backend/Laboratorio.Collaboration/Contracts/ModelCatalog.json' with { type: 'json' };

export const modelLimits = catalog.limits;
export const modelCatalog = catalog.models;
export const PRIVATE_MODEL = 'local-model';
export const isCatalogModel = (type) => Object.hasOwn(modelCatalog, type);

export function validateModelBudget(models) {
  if (models.length > modelLimits.sceneModels) throw new Error('Limite de seis modelos 3D por cena.');
  for (const [key, limit] of [['vertices', 'sceneVertices'], ['triangles', 'sceneTriangles'], ['pixels', 'scenePixels']]) {
    if (models.reduce((sum, model) => sum + model[key], 0) > modelLimits[limit]) {
      throw new Error('O conjunto de modelos ultrapassa o orçamento de vértices, triângulos ou pixels da cena.');
    }
  }
}
