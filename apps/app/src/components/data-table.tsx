import {
  columnVisibilityFeature,
  metaHelper,
  type RowData,
  type TableOptions,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Columns3Icon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// A server-side table: the server sorts, filters and pages; the URL holds the table state (so
// views are shareable and back/forward work); TanStack Table only owns columns and visibility.
// Filters are the page's own controls, passed in as `toolbar`.

export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  columnMeta: metaHelper<{
    /** Classes for the column's header and cells, e.g. "text-right" or a max width. */
    className?: string;
    /** Off until the user turns it on in the Columns menu. */
    hiddenByDefault?: boolean;
  }>(),
});
/** Build columns with `createColumnHelper<DataTableFeatures, Row>()`. */
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumns<TData extends RowData> = TableOptions<
  DataTableFeatures,
  TData
>["columns"];

export const pageSizes = [25, 50, 100, 200] as const;

/** The table's URL state. `.extend()` it with the page's filters for `validateSearch`. */
export function dataTableSearchSchema<TSort extends string>(
  sortable: readonly [TSort, ...TSort[]],
  defaultSort: NoInfer<TSort>,
) {
  return z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(pageSizes[0]),
    sort: z.enum(sortable).default(defaultSort),
    order: z.enum(["asc", "desc"]).default("desc"),
    /** Visible column ids, once the user has changed them from the defaults. */
    columns: z.array(z.string()).optional(),
  });
}
export type DataTableState<TSort extends string> = z.infer<
  ReturnType<typeof dataTableSearchSchema<TSort>>
>;

const noRows: never[] = [];

export function DataTable<TData extends RowData, TSort extends string>({
  columns,
  rows,
  total,
  getRowId,
  state,
  onStateChange,
  sortable,
  isFetching = false,
  error,
  noun,
  toolbar,
  empty = `No ${noun}s found.`,
  onRowClick,
  rowActions,
}: {
  /** Keep the array stable (module scope or memo): a new one rebuilds the column model. */
  columns: DataTableColumns<TData>;
  /** The current page from the server; undefined until the first one arrives. */
  rows: TData[] | undefined;
  /** Rows matching the filters, across all pages. */
  total: number | undefined;
  getRowId: (row: TData) => string;
  state: DataTableState<TSort>;
  /** Write it to the URL. Sort and page size changes come with `page: 1`. */
  onStateChange: (next: Partial<DataTableState<TSort>>) => void;
  /** Column ids the server can sort by; their headers become sort buttons. */
  sortable: readonly TSort[];
  /** Dims the rows while a new page loads over the previous one. */
  isFetching?: boolean;
  error?: Error | null;
  /** Singular, for the count and empty state: "generation" → "1,234 generations". */
  noun: string;
  /** Filters, shown left of the Columns menu. */
  toolbar?: ReactNode;
  empty?: ReactNode;
  /** Clicks on links, buttons and inputs inside the row don't count. */
  onRowClick?: (row: TData) => void;
  /** A trailing cell per row, e.g. an actions menu. */
  rowActions?: (row: TData) => ReactNode;
}) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows ?? noRows,
    getRowId,
    state: {
      columnVisibility: Object.fromEntries(
        columns.flatMap((column) => {
          const id = column.id ?? ("accessorKey" in column ? String(column.accessorKey) : null);
          if (id === null || column.enableHiding === false) return [];
          return [[id, state.columns ? state.columns.includes(id) : !column.meta?.hiddenByDefault]];
        }),
      ),
    },
  });
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const visibleColumns = table.getVisibleLeafColumns();
  const colSpan = visibleColumns.length + (rowActions ? 1 : 0);
  const pages = Math.max(1, Math.ceil((total ?? 0) / state.pageSize));
  const goTo = (page: number) => onStateChange({ page });
  const pageSizeId = useId();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="ml-auto" />}>
            <Columns3Icon />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {hideable.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) =>
                    onStateChange({
                      columns: visibleColumns
                        .map((visible) => visible.id)
                        .filter((id) => id !== column.id)
                        .concat(checked ? [column.id] : []),
                    })
                  }
                >
                  {typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Its own scroll box, so the header can stick while the rows scroll in both directions. */}
      <div className="max-h-[75vh] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--color-border)]">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sortId = sortable.find((id) => id === header.column.id);
                  const sorted = sortId !== undefined && state.sort === sortId;
                  return (
                    <TableHead
                      key={header.id}
                      className={header.column.columnDef.meta?.className}
                      aria-sort={
                        sorted ? (state.order === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {header.isPlaceholder ? null : sortId === undefined ? (
                        <table.FlexRender header={header} />
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() =>
                            onStateChange({
                              sort: sortId,
                              order: sorted && state.order === "desc" ? "asc" : "desc",
                              page: 1,
                            })
                          }
                        >
                          <table.FlexRender header={header} />
                          {sorted &&
                            (state.order === "desc" ? (
                              <ArrowDownIcon className="size-3.5" />
                            ) : (
                              <ArrowUpIcon className="size-3.5" />
                            ))}
                        </button>
                      )}
                    </TableHead>
                  );
                })}
                {rowActions && (
                  <TableHead className="w-0">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={cn("transition-opacity", isFetching && rows && "opacity-60")}>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={
                  onRowClick &&
                  ((e) => {
                    // Menus render in a portal, but React still bubbles their clicks here.
                    if (
                      !(e.target instanceof Element) ||
                      !e.currentTarget.contains(e.target) ||
                      e.target.closest("a, button, input, select, label")
                    ) {
                      return;
                    }
                    onRowClick(row.original);
                  })
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
                {rowActions && <TableCell>{rowActions(row.original)}</TableCell>}
              </TableRow>
            ))}
            {rows?.length === 0 && (
              <StatusRow colSpan={colSpan} className="text-muted-foreground">
                {empty}
              </StatusRow>
            )}
            {!rows &&
              (error ? (
                <StatusRow colSpan={colSpan} className="text-destructive">
                  Couldn't load {noun}s: {error.message}
                </StatusRow>
              ) : (
                <StatusRow colSpan={colSpan} className="text-muted-foreground">
                  Loading…
                </StatusRow>
              ))}
          </TableBody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span aria-live="polite">
          {total === undefined
            ? " "
            : `${total.toLocaleString()} ${total === 1 ? noun : `${noun}s`}`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={pageSizeId}>Rows</label>
          <NativeSelect
            id={pageSizeId}
            size="sm"
            value={state.pageSize}
            onChange={(e) => onStateChange({ pageSize: Number(e.target.value), page: 1 })}
          >
            {pageSizes.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="tabular-nums">
            Page {state.page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          <PageButton label="First page" disabled={state.page <= 1} onClick={() => goTo(1)}>
            <ChevronsLeftIcon />
          </PageButton>
          <PageButton
            label="Previous page"
            disabled={state.page <= 1}
            onClick={() => goTo(Math.min(state.page, pages) - 1)}
          >
            <ChevronLeftIcon />
          </PageButton>
          <PageButton
            label="Next page"
            disabled={state.page >= pages}
            onClick={() => goTo(state.page + 1)}
          >
            <ChevronRightIcon />
          </PageButton>
          <PageButton label="Last page" disabled={state.page >= pages} onClick={() => goTo(pages)}>
            <ChevronsRightIcon />
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  colSpan,
  className,
  children,
}: {
  colSpan: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={cn("h-24 text-center whitespace-normal", className)}>
        {children}
      </TableCell>
    </TableRow>
  );
}

function PageButton({ label, ...props }: { label: string } & ComponentProps<typeof Button>) {
  return <Button variant="outline" size="icon-sm" aria-label={label} title={label} {...props} />;
}

/**
 * A text filter that commits `delay` ms after typing stops, so each keystroke isn't a request
 * (or a history entry). Follows `value` when the URL changes underneath it (back/forward).
 */
export function DebouncedInput({
  value,
  onCommit,
  delay = 300,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
  delay?: number;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(next), delay);
      }}
    />
  );
}

/** A toolbar filter: "Any" or one option. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="max-w-48"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">Any</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
