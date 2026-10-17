import { useCategories } from '@/context/categories';
import { flattenTree } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';

interface CategorySelectProps {
  value: number | null;
  onChange: (id: number | null) => void;
  /** Label of the "no category" option. */
  emptyLabel: string;
  isDisabled?: (node: CategoryNode) => boolean;
  id?: string;
}

/** <select> over the category tree, indented by depth. */
export function CategorySelect({ value, onChange, emptyLabel, isDisabled, id }: CategorySelectProps) {
  const { tree } = useCategories();
  return (
    <select
      id={id}
      className="input select"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
    >
      <option value="">{emptyLabel}</option>
      {flattenTree(tree).map((node) => (
        <option key={node.id} value={node.id} disabled={isDisabled?.(node)}>
          {'   '.repeat(node.depth - 1)}
          {node.depth > 1 ? '└ ' : ''}
          {node.icon ? `${node.icon} ` : ''}
          {node.name}
        </option>
      ))}
    </select>
  );
}
