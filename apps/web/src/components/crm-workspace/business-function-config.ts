import type { BadgeTone, ShopifyActiveItem, ShopifyIconName } from "../shopify-ui";

export type BusinessFunctionKey = "delivery" | "finance" | "management" | "proposals" | "support";

type ReadinessTone = BadgeTone;

export type BusinessFunctionConfig = {
  active: ShopifyActiveItem;
  action: {
    label: string;
    reason: string;
  };
  description: string;
  featureCoverage: string;
  icon: ShopifyIconName;
  metrics: Array<{
    detail: string;
    label: string;
    value: string;
  }>;
  operatingFunction: string;
  readiness: Array<{
    detail: string;
    label: string;
    tone: ReadinessTone;
    value: string;
  }>;
  route: string;
  title: string;
  workflows: Array<{
    evidence: string;
    name: string;
    nextStep: string;
    owner: string;
    readiness: string;
    tone: ReadinessTone;
  }>;
};

export const businessFunctionConfigs: Record<BusinessFunctionKey, BusinessFunctionConfig> = {
  delivery: {
    active: "delivery",
    action: {
      label: "Tạo task theo stage",
      reason: "Task mẫu theo stage được tạo từ luồng BD kickoff khi chọn scaffold."
    },
    description:
      "Không gian quản lý các dự án đã được bàn giao từ cơ hội thắng, theo dõi từng stage, PIC, timeline, task và blocker.",
    featureCoverage: "Dự án triển khai theo stage",
    icon: "handoff",
    metrics: [
      { label: "Màn hình", value: "Dự án triển khai", detail: "Project đã nhận từ cơ hội thắng" },
      { label: "Dữ liệu", value: "ProjectStage thật", detail: "PIC, timeline, blocker và nghiệm thu theo stage" },
      { label: "Task", value: "Gom theo stage", detail: "Task chi tiết vẫn là cấp thực thi thấp nhất" }
    ],
    operatingFunction: "Vận hành triển khai",
    readiness: [
      { label: "Điều hướng", value: "Đã có", detail: "Menu Triển khai có mục Dự án triển khai riêng.", tone: "success" },
      { label: "Quy trình", value: "Đã nối", detail: "BD kickoff seed ProjectStage và tùy chọn task template.", tone: "success" },
      { label: "Thao tác", value: "Đã có", detail: "Có edit stage, tạo task theo stage và stage quick action.", tone: "success" }
    ],
    route: "/delivery",
    title: "Dự án triển khai",
    workflows: [
      {
        evidence: "Chi tiết cơ hội đã có checklist bàn giao và lý do khóa thao tác.",
        name: "Rà soát bàn giao",
        nextStep: "Đưa checklist bàn giao thành hàng đợi theo chủ sở hữu.",
        owner: "Sales + Delivery Lead",
        readiness: "Một phần",
        tone: "info"
      },
      {
        evidence: "Mô hình stage triển khai đã được chốt ở lớp nghiệp vụ.",
        name: "Giai đoạn triển khai",
        nextStep: "Lưu trạng thái stage và lịch sử chuyển stage.",
        owner: "Delivery Lead",
        readiness: "Đã thiết kế",
        tone: "warning"
      },
      {
        evidence: "Quy tắc xử lý blocker đã có trong checklist nghiệm thu.",
        name: "Blockers",
        nextStep: "Bổ sung luồng tạo, xử lý và nâng cấp blocker.",
        owner: "Delivery + Chăm sóc khách hàng",
        readiness: "Cần bật thêm",
        tone: "warning"
      },
      {
        evidence: "Bằng chứng nghiệm thu là điều kiện trước khi kích hoạt thanh toán.",
        name: "Bằng chứng nghiệm thu",
        nextStep: "Nối chứng từ nghiệm thu với kiểm soát dự án và tài chính.",
        owner: "Delivery + Finance",
        readiness: "Cần bật thêm",
        tone: "warning"
      }
    ]
  },
  finance: {
    active: "finance",
    action: {
      label: "Mở hàng đợi tài chính",
      reason: "Các thao tác hóa đơn, thanh toán và công nợ vẫn đang khóa trong bản đọc hiện tại."
    },
    description:
      "Không gian kiểm soát hợp đồng, lịch thanh toán, hóa đơn, chứng từ thanh toán và nhắc công nợ.",
    featureCoverage: "Hợp đồng, phụ lục, lịch thanh toán, hóa đơn và công nợ",
    icon: "cash",
    metrics: [
      { label: "Màn hình", value: "Tài chính", detail: "Không gian riêng cho đội tài chính" },
      { label: "Nguồn dữ liệu", value: "Đã sẵn sàng", detail: "Lịch thu, hóa đơn và công nợ đã có dữ liệu đọc" },
      { label: "Cổng tiếp theo", value: "Thao tác tài chính", detail: "Hành động hóa đơn, thanh toán và hàng đợi công nợ" }
    ],
    operatingFunction: "Kiểm soát thương mại & tài chính",
    readiness: [
      { label: "Điều hướng", value: "Đã hiển thị", detail: "Tài chính đã có mục riêng trong menu.", tone: "success" },
      { label: "Dữ liệu", value: "Đã sẵn sàng", detail: "Lịch thanh toán, hóa đơn và công nợ đã có dữ liệu đọc.", tone: "success" },
      { label: "Quy trình", value: "Một phần", detail: "Modal tài chính đã có; hàng đợi xử lý là lớp tiếp theo.", tone: "info" }
    ],
    route: "/finance",
    title: "Tài chính & Kiểm soát thương mại",
    workflows: [
      {
        evidence: "Hợp đồng và chứng từ ký đã có khung dữ liệu.",
        name: "Kiểm soát hợp đồng",
        nextStep: "Hiển thị gói hợp đồng đã ký và trạng thái phụ lục.",
        owner: "Sales + Finance",
        readiness: "Đã sẵn sàng",
        tone: "success"
      },
      {
        evidence: "Lịch thanh toán và mốc thu tiền đã có dữ liệu.",
        name: "Lịch thanh toán",
        nextStep: "Bổ sung chỉnh sửa, phê duyệt và bản xem an toàn cho khách hàng.",
        owner: "Finance",
        readiness: "Đã sẵn sàng",
        tone: "success"
      },
      {
        evidence: "Hóa đơn và sổ ghi nhận thanh toán đã có nền dữ liệu.",
        name: "Hóa đơn & thanh toán",
        nextStep: "Xây hàng đợi hóa đơn và luồng tải chứng từ thanh toán.",
        owner: "Tài chính",
        readiness: "Cần giao diện",
        tone: "info"
      },
      {
        evidence: "Danh sách công nợ quá hạn đã có dữ liệu đọc.",
        name: "Theo dõi công nợ",
        nextStep: "Nối công việc nhắc nợ và chủ sở hữu xử lý.",
        owner: "Finance + Founder",
        readiness: "Cần quy trình",
        tone: "warning"
      }
    ]
  },
  management: {
    active: "management",
    action: {
      label: "Rà soát chỉ số điều hành",
      reason: "Sẽ bật khi danh mục chỉ số, độ mới dữ liệu và hàng đợi hành động được chốt."
    },
    description:
      "Không gian điều hành cho chỉ số quản trị, độ mới dữ liệu, hàng đợi hành động và nhịp review định kỳ.",
    featureCoverage: "Chỉ số điều hành và nhịp review quản trị",
    icon: "trend",
    metrics: [
      { label: "Màn hình", value: "Điều hành", detail: "Hiển thị định hướng quản trị, chưa giả lập hoàn tất" },
      { label: "Nguồn dữ liệu", value: "Đang chuẩn bị", detail: "Cần chốt danh mục chỉ số và chủ sở hữu" },
      { label: "Cần bật thêm", value: "Hành động điều hành", detail: "Hàng đợi, nhật ký review và snapshot" }
    ],
    operatingFunction: "Điều hành & quản trị",
    readiness: [
      { label: "Điều hướng", value: "Đã có", detail: "Menu đã có khu vực điều hành riêng.", tone: "success" },
      { label: "Khung chỉ số", value: "Đang thiết kế", detail: "Mô hình chỉ số và cadence review đã có hướng.", tone: "info" },
      { label: "Thao tác", value: "Đang khóa", detail: "Chưa mở hàng đợi hành động điều hành.", tone: "warning" }
    ],
    route: "/management",
    title: "Điều hành",
    workflows: [
      {
        evidence: "Khung chỉ số, nhịp review và quyền xem đã được định nghĩa ở lớp nghiệp vụ.",
        name: "Danh mục chỉ số",
        nextStep: "Chốt chỉ số được phép công bố, chủ sở hữu và mức nhạy cảm.",
        owner: "Founder/GM",
        readiness: "Đang thiết kế",
        tone: "info"
      },
      {
        evidence: "Mỗi chỉ số cần nguồn dữ liệu, chủ sở hữu và độ mới rõ ràng trước khi công bố.",
        name: "Nguồn dữ liệu chỉ số",
        nextStep: "Bổ sung kiểm tra độ mới dữ liệu và người chịu trách nhiệm.",
        owner: "Data/Governance",
        readiness: "Cần bật thêm",
        tone: "warning"
      },
      {
        evidence: "Các cảnh báo vượt ngưỡng cần có người xử lý và lịch review.",
        name: "Hàng đợi hành động",
        nextStep: "Tạo chủ sở hữu hành động và nhật ký review.",
        owner: "Founder/GM + Ops",
        readiness: "Cần bật thêm",
        tone: "warning"
      },
      {
        evidence: "Số liệu chi phí và biên lợi nhuận cần ẩn theo vai trò.",
        name: "Bằng chứng phân quyền",
        nextStep: "Bổ sung smoke test cho quyền xem từng nhóm số liệu.",
        owner: "Finance + Governance",
        readiness: "Bắt buộc",
        tone: "warning"
      }
    ]
  },
  proposals: {
    active: "proposals",
    action: {
      label: "Xem hàng đợi đề xuất",
      reason: "Các hành động hàng đợi cần tích hợp Lark Approval live và UI gói đề xuất."
    },
    description:
      "Không gian kiểm soát SOW, báo giá, phê duyệt chiết khấu/điều khoản thanh toán và cổng gửi khách hàng.",
    featureCoverage: "Đề xuất, SOW, báo giá và phê duyệt deal",
    icon: "briefcase",
    metrics: [
      { label: "Màn hình", value: "Đề xuất", detail: "Không gian riêng cho proposal/SOW" },
      { label: "Nguồn dữ liệu", value: "Đã sẵn sàng", detail: "Gói đề xuất và bản ghi phê duyệt đã có dữ liệu đọc" },
      { label: "Cổng tiếp theo", value: "Trải nghiệm phê duyệt", detail: "Hàng đợi phê duyệt và trình tạo gói" }
    ],
    operatingFunction: "Quản trị đề xuất & phê duyệt",
    readiness: [
      { label: "Điều hướng", value: "Đã hiển thị", detail: "Đề xuất đã có workbench riêng.", tone: "success" },
      { label: "Dữ liệu", value: "Đã sẵn sàng", detail: "Gói đề xuất và bản ghi phê duyệt đã có.", tone: "success" },
      { label: "Tự động hóa", value: "Đang chờ", detail: "Luồng phê duyệt live chưa được nối.", tone: "warning" }
    ],
    route: "/proposals",
    title: "Đề xuất & phê duyệt",
    workflows: [
      {
        evidence: "Gói đề xuất đã có cấu trúc tài liệu bắt buộc.",
        name: "Gói SOW",
        nextStep: "Hoàn thiện trình tạo gói với checklist tài liệu.",
        owner: "Sales Owner",
        readiness: "Đã sẵn sàng",
        tone: "success"
      },
      {
        evidence: "Chiết khấu và điều khoản thanh toán có điều kiện phê duyệt.",
        name: "Báo giá",
        nextStep: "Hiển thị phiên bản báo giá, trạng thái duyệt và khóa gửi khách hàng.",
        owner: "Sales + Finance",
        readiness: "Đã sẵn sàng",
        tone: "success"
      },
      {
        evidence: "Bản ghi quyết định phê duyệt đã có, luồng live chưa bật.",
        name: "Hàng đợi phê duyệt",
        nextStep: "Nối luồng phê duyệt và đồng bộ quyết định.",
        owner: "Founder/GM",
        readiness: "Cần tự động hóa",
        tone: "warning"
      },
      {
        evidence: "Chỉ được gửi khách hàng khi gói đề xuất đã đủ tài liệu và phê duyệt.",
        name: "Cổng gửi khách hàng",
        nextStep: "Khóa gửi nếu gói chưa được duyệt hoặc chưa đủ tài liệu.",
        owner: "Sales Ops",
        readiness: "Cần thao tác UI",
        tone: "info"
      }
    ]
  },
  support: {
    active: "support",
    action: {
      label: "Rà soát hỗ trợ",
      reason: "Sẽ bật khi luồng ticket, SLA và cộng tác khách hàng được nối đủ."
    },
    description:
      "Không gian chăm sóc khách hàng cho ticket, SLA, phát sinh change request, review sử dụng và tín hiệu gia hạn.",
    featureCoverage: "Ticket hỗ trợ, SLA và review sử dụng",
    icon: "users",
    metrics: [
      { label: "Màn hình", value: "Hỗ trợ", detail: "Khu vực chăm sóc khách hàng đã có trong nền tảng" },
      { label: "Dữ liệu", value: "Đang khóa", detail: "Cần bật dữ liệu yêu cầu hỗ trợ và cam kết phản hồi" },
      { label: "Cần bật thêm", value: "Cam kết phản hồi", detail: "Tạo yêu cầu hỗ trợ, bình luận, nâng cấp và đo hài lòng" }
    ],
    operatingFunction: "Chăm sóc khách hàng & hỗ trợ",
    readiness: [
      { label: "Điều hướng", value: "Đã có", detail: "Hỗ trợ khách hàng đã có khu vực vận hành riêng.", tone: "success" },
      { label: "Thao tác", value: "Đang khóa", detail: "Yêu cầu hỗ trợ và cam kết phản hồi chưa mở thao tác trực tiếp.", tone: "warning" },
      { label: "Giao diện khách hàng", value: "Một phần", detail: "Màn hình khách hàng đã có, nhưng thao tác hỗ trợ cần nối thêm.", tone: "info" }
    ],
    route: "/support",
    title: "Hỗ trợ khách hàng",
    workflows: [
      {
        evidence: "Ticket hỗ trợ đang là khoảng trống cần triển khai tiếp.",
        name: "Tiếp nhận yêu cầu hỗ trợ",
        nextStep: "Bổ sung tạo, cập nhật và đổi trạng thái yêu cầu hỗ trợ.",
        owner: "Chăm sóc khách hàng",
        readiness: "Đang khóa",
        tone: "warning"
      },
      {
        evidence: "Quy tắc SLA, phân tuyến và nâng cấp đã có khung.",
        name: "Theo dõi cam kết phản hồi",
        nextStep: "Bật chính sách phản hồi, giờ làm việc và cảnh báo nâng cấp.",
        owner: "Chăm sóc khách hàng + Delivery",
        readiness: "Cần bật thêm",
        tone: "warning"
      },
      {
        evidence: "Review sử dụng hằng tháng là một phần của chăm sóc khách hàng.",
        name: "Review sử dụng",
        nextStep: "Nối số liệu sử dụng với health và tín hiệu gia hạn.",
        owner: "Chăm sóc khách hàng",
        readiness: "Đã thiết kế",
        tone: "info"
      },
      {
        evidence: "Yêu cầu phát sinh có tính phí cần quay lại luồng đề xuất/triển khai.",
        name: "Change request",
        nextStep: "Đưa yêu cầu có phí về hàng đợi đề xuất hoặc delivery.",
        owner: "Chăm sóc khách hàng + Finance",
        readiness: "Cần quy trình",
        tone: "warning"
      }
    ]
  }
};
