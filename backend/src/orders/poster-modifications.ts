interface SelectedModifier {
  posterId?: string;
  qty?: number;
}

/**
 * Количество фиксированного компонента определяет техкарта, а не старый
 * клиент. Build 4 передаёт один выбранный вариант без qty даже для группы
 * min=max=2 (например, два фри). Не угадываем количества в группах выбора.
 */
export function posterModifications(
  rawGroups: unknown,
  selected: SelectedModifier[],
): { m: number; a: number }[] {
  const fixed = new Map<string, number>();
  const ambiguous = new Set<string>();
  if (Array.isArray(rawGroups)) {
    for (const group of rawGroups) {
      if (!group || Number(group.is_deleted ?? 0) !== 0) continue;
      const min = Number(group.num_min);
      const max = Number(group.num_max);
      if (!Number.isInteger(min) || min <= 1 || min > 99 || max !== min) continue;
      if (!Array.isArray(group.modifications) || group.modifications.length !== 1) continue;
      const id = String(group.modifications[0]?.dish_modification_id ?? '');
      if (!/^\d+$/.test(id)) continue;
      if (fixed.has(id) && fixed.get(id) !== min) ambiguous.add(id);
      fixed.set(id, min);
    }
  }
  for (const id of ambiguous) fixed.delete(id);

  const sentFixed = new Set<string>();
  return selected.filter(modifier => modifier.posterId).flatMap(modifier => {
    const id = String(modifier.posterId);
    const requiredQty = fixed.get(id);
    // Два одинаковых выбора старого/другого клиента не превращают две
    // обязательные порции в четыре. Количество задано на одно комбо.
    if (requiredQty !== undefined) {
      if (sentFixed.has(id)) return [];
      sentFixed.add(id);
    }
    return [{ m: Number(id), a: requiredQty ?? modifier.qty ?? 1 }];
  });
}
