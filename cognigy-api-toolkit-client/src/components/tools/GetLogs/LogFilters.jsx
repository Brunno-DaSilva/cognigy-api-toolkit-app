import Card from "../../ui/Card";
import FormField from "../../ui/FormField";
import TypeChip from "../../ui/TypeChip";
import { TYPE_CONFIG, SORT_OPTIONS } from "../../../constants";

const LogFilters = ({ cfg, onChange, types, onToggleType }) => (
  <Card title="Filters">
    <div className="mb-14">
      <FormField label="Log Types — leave empty for all">
        <div className="chip-group">
          {Object.entries(TYPE_CONFIG).map(([key, { label, color }]) => (
            <TypeChip
              key={key}
              label={label}
              color={color}
              active={types.includes(key)}
              onClick={() => onToggleType(key)}
            />
          ))}
        </div>
      </FormField>
    </div>

    <div className="grid grid--4 mb-14">
      <FormField label="Text Filter">
        <input
          className="input"
          placeholder="msg / type / traceId"
          value={cfg.filter}
          onChange={(e) => onChange("filter", e.target.value)}
        />
      </FormField>
      <FormField label="Flow Name">
        <input
          className="input"
          placeholder="e.g. 2.0 - AI Agent"
          value={cfg.flowName}
          onChange={(e) => onChange("flowName", e.target.value)}
        />
      </FormField>
      <FormField label="User ID">
        <input
          className="input"
          placeholder="e.g. +14434610694"
          value={cfg.userId}
          onChange={(e) => onChange("userId", e.target.value)}
        />
      </FormField>
      <FormField label="Sort">
        <select
          className="select"
          value={cfg.sort}
          onChange={(e) => onChange("sort", e.target.value)}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FormField>
    </div>
  </Card>
);

export default LogFilters;
