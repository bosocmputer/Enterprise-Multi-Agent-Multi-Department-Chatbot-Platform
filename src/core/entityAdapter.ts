import type { EntityCandidate, ProductCandidate } from "./types.js";

export function productToEntity(product: ProductCandidate, entityType: string): EntityCandidate {
  const metadata = product.unit ? { unit: product.unit } : undefined;
  return {
    description: product.name === product.code ? undefined : product.name,
    id: product.code,
    label: product.name,
    metadata,
    type: entityType
  };
}

export function attachEntity(product: ProductCandidate, entityType: string, overwrite = false): ProductCandidate {
  return {
    ...product,
    entity: overwrite ? productToEntity(product, entityType) : product.entity ?? productToEntity(product, entityType)
  };
}

export function attachEntities(products: ProductCandidate[], entityType: string): ProductCandidate[] {
  return products.map((product) => attachEntity(product, entityType));
}

export function entitiesFromProducts(products: ProductCandidate[], entityType: string): EntityCandidate[] {
  return attachEntities(products, entityType).map((product) => product.entity as EntityCandidate);
}

export function entityDisplayId(entity: EntityCandidate | undefined, fallback: string): string {
  return entity?.id ?? fallback;
}

export function entityDisplayLabel(entity: EntityCandidate | undefined, fallback: string): string {
  return entity?.label ?? fallback;
}
